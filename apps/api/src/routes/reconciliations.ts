/**
 * Reconciliation session lifecycle, statement import, and matching.
 *
 * Closing a session is handled in `reconciliations.close.ts` — that is where the
 * residual rule is enforced, and keeping it separate stops this file from
 * growing past the size limit while the enforcement logic stays legible.
 *
 * Resolutions (correcting, adding, deleting a transaction; adjusting an opening)
 * deliberately have NO endpoint here. They reuse the existing transaction and
 * account routes, which keeps every correction on the ledger gate and prevents
 * the reconciliation UI from developing its own divergent semantics for an edit.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { prisma, Prisma } from '@budget-tracker/db';
import {
  CreateMatchSchema,
  CreateReconciliationSessionSchema,
  ImportStatementResultSchema,
  ImportStatementSchema,
  ReconciliationMatchSchema,
  ReconciliationSessionDetailSchema,
  ReconciliationSessionSchema,
  ReconciliationStatusSchema,
  RunMatchResultSchema,
  UpdateReconciliationSessionSchema,
  reconcile,
  appTxDirection,
  type AppTx,
  type StatementLine,
} from '@budget-tracker/core';
import { ErrorSchema, createRouter } from '../lib/errors.js';
import { computeResidual } from '../lib/reconciliation/residual.js';
import {
  serializeMatch,
  serializeSession,
  serializeStatementRow,
} from '../lib/reconciliation/serialization.js';
import { parseStatementCsv, StatementParseError } from '../lib/reconciliation/statement-parser.js';

const app = createRouter();

const iso = (d: Date): string => d.toISOString().slice(0, 10);

/** Days of slack when loading app transactions around the reported window. */
const LOAD_PAD_DAYS = 7;

/**
 * The transactions a reconciliation considers, in one place.
 *
 * Both the matcher and the detail view need exactly this set, and the window
 * rules are subtle enough that two copies would drift: rows are loaded with
 * padding because a charge dated on the last day of a period can post after it,
 * and fully-offset rows are excluded because they move no cash and the bank
 * never prints them.
 *
 * Amounts are compared as `netAmount`, never gross `amount`. Rewards and gift
 * cards are settled before the charge reaches the card, so a $200.00 basket with
 * $60.00 of rewards prints as $140.00 on the statement. The residual already
 * sums netAmount, so using gross here would also put the matcher and the
 * residual in disagreement about the same transaction.
 */
async function loadCandidateTransactions(
  accountId: string,
  period: { periodStart: Date; periodEnd: Date },
) {
  return prisma.transaction.findMany({
    where: {
      parentId: null,
      date: {
        gte: new Date(period.periodStart.getTime() - LOAD_PAD_DAYS * 86_400_000),
        lte: new Date(period.periodEnd.getTime() + LOAD_PAD_DAYS * 86_400_000),
      },
      OR: [{ accountId }, { toAccountId: accountId, type: 'TRANSFER' }],
      NOT: { netAmount: 0 },
    },
    select: {
      id: true,
      date: true,
      name: true,
      amount: true,
      netAmount: true,
      type: true,
      toAccountId: true,
      // Disclosure (reconcile-merge Req 5): a recurring link means merging drops
      // this occurrence's record.
      expenseId: true,
      incomeId: true,
      // A TRADE's BUY/SELL decides its direction when the broker is the account
      // being reconciled (Cash Wallet). Without it every sell mis-signs as a charge.
      tradeDetail: { select: { direction: true } },
      note: true,
    },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  });
}

/**
 * The subset of the given transaction ids that a ScheduledTransaction is matched
 * to. Merging such a row deletes it and reverts its scheduled item to PENDING —
 * disclosed before the merge (reconcile-merge Req 5.3).
 */
async function scheduledMatchIds(transactionIds: string[]): Promise<Set<string>> {
  if (transactionIds.length === 0) return new Set();
  const rows = await prisma.scheduledTransaction.findMany({
    where: { transactionId: { in: transactionIds } },
    select: { transactionId: true },
  });
  return new Set(rows.map((r) => r.transactionId).filter((id): id is string => id !== null));
}

// ─── POST / ───

const createRoute_ = createRoute({
  method: 'post',
  path: '/',
  tags: ['Reconciliation'],
  summary: 'Open a reconciliation session',
  request: {
    body: { content: { 'application/json': { schema: CreateReconciliationSessionSchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: ReconciliationSessionSchema } },
      description: 'Session opened',
    },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not Found' },
    409: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Conflict' },
  },
});

app.openapi(createRoute_, async (c) => {
  const body = c.req.valid('json');

  const account = await prisma.account.findUnique({ where: { id: body.accountId } });
  if (!account) return c.json({ error: 'Account not found' }, 404);

  try {
    const session = await prisma.reconciliationSession.create({ data: body });
    return c.json(serializeSession(session), 201);
  } catch (err) {
    // The partial unique index permits only one DRAFT session per account:
    // two concurrent drafts would let the same period be reconciled twice with
    // conflicting resolutions.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return c.json({ error: 'This account already has a draft reconciliation' }, 409);
    }
    throw err;
  }
});

// ─── PATCH /:id ───

const updateSessionRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Reconciliation'],
  summary: "Change a draft session's ending balance or cutoff date",
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: UpdateReconciliationSessionSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ReconciliationSessionSchema } },
      description: 'Updated',
    },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not Found' },
    409: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Conflict' },
  },
});

app.openapi(updateSessionRoute, async (c) => {
  const { id } = c.req.valid('param');
  const { statementEndingBalance, periodEnd } = c.req.valid('json');

  const session = await prisma.reconciliationSession.findUnique({ where: { id } });
  if (!session) return c.json({ error: 'Reconciliation session not found' }, 404);
  // A closed session's residual is a historical record of what was agreed; a
  // later anchor or cutoff edit would rewrite that agreement after the fact.
  if (session.status !== 'DRAFT') {
    return c.json({ error: 'Only a draft session can be changed' }, 409);
  }

  const updated = await prisma.reconciliationSession.update({
    where: { id },
    data: {
      ...(statementEndingBalance !== undefined ? { statementEndingBalance } : {}),
      ...(periodEnd !== undefined ? { periodEnd } : {}),
    },
  });
  return c.json(serializeSession(updated), 200);
});

// ─── GET / ───

const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Reconciliation'],
  summary: 'List reconciliation sessions',
  request: {
    query: z.object({
      accountId: z.string().optional(),
      status: ReconciliationStatusSchema.optional(),
    }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(ReconciliationSessionSchema) } },
      description: 'Sessions',
    },
  },
});

app.openapi(listRoute, async (c) => {
  const { accountId, status } = c.req.valid('query');
  const sessions = await prisma.reconciliationSession.findMany({
    where: { ...(accountId ? { accountId } : {}), ...(status ? { status } : {}) },
    orderBy: [{ periodEnd: 'desc' }, { createdAt: 'desc' }],
  });
  return c.json(sessions.map(serializeSession), 200);
});

// ─── GET /:id ───

const detailRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Reconciliation'],
  summary: 'Get a session with rows, matches, and the live residual',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      content: { 'application/json': { schema: ReconciliationSessionDetailSchema } },
      description: 'Session detail',
    },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not Found' },
  },
});

app.openapi(detailRoute, async (c) => {
  const { id } = c.req.valid('param');
  const session = await prisma.reconciliationSession.findUnique({
    where: { id },
    include: {
      statementRows: { orderBy: [{ postedDate: 'asc' }, { createdAt: 'asc' }] },
      matches: true,
    },
  });
  if (!session) return c.json({ error: 'Reconciliation session not found' }, 404);

  const residual = await computeResidual(id);
  // The displayed candidates must match what the matcher considers, so the load
  // window runs to whichever is later — the cutoff or the statement's last posted
  // row — mirroring the match route. Otherwise a cutoff before the statement's
  // end would hide, in step 2, rows the matcher paired against.
  const lastPosted = session.statementRows.at(-1)?.postedDate;
  const loadEnd =
    lastPosted && lastPosted.getTime() > session.periodEnd.getTime()
      ? lastPosted
      : session.periodEnd;
  const appTransactions = await loadCandidateTransactions(session.accountId, {
    periodStart: session.periodStart,
    periodEnd: loadEnd,
  });
  const scheduled = await scheduledMatchIds(appTransactions.map((t) => t.id));

  return c.json(
    {
      ...serializeSession(session),
      statementRows: session.statementRows.map(serializeStatementRow),
      matches: session.matches.map(serializeMatch),
      appTransactions: appTransactions.map((t) => ({
        id: t.id,
        date: t.date,
        name: t.name,
        // What the account was actually charged — the figure the bank prints.
        amount: Math.abs(t.netAmount.toNumber()),
        // Gross-minus-net offset, retained for the correction path. 0 for
        // go-forward rows (amount == netAmount since the rewardsApplied discount
        // was retired); non-zero only for historical rows where the two diverge.
        offset: Math.round((t.amount.toNumber() - t.netAmount.toNumber()) * 100) / 100,
        type: t.type,
        inbound: t.toAccountId === session.accountId,
        // Lets the UI's shared appTxDirection sign a Cash Wallet sell as a credit.
        tradeDirection: t.tradeDetail?.direction ?? null,
        note: t.note,
        // Disclosure (reconcile-merge Req 5): what a merge of this row would drop.
        recurringLink: t.expenseId !== null || t.incomeId !== null,
        scheduledMatch: scheduled.has(t.id),
      })),
      residual: residual!,
    },
    200,
  );
});

// ─── POST /:id/import ───

const importRoute = createRoute({
  method: 'post',
  path: '/{id}/import',
  tags: ['Reconciliation'],
  summary: 'Import a statement CSV into a session',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: ImportStatementSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ImportStatementResultSchema } },
      description: 'Imported',
    },
    400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Bad Request' },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not Found' },
    409: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Conflict' },
  },
});

app.openapi(importRoute, async (c) => {
  const { id } = c.req.valid('param');
  const { csv } = c.req.valid('json');

  const session = await prisma.reconciliationSession.findUnique({ where: { id } });
  if (!session) return c.json({ error: 'Reconciliation session not found' }, 404);
  if (session.status !== 'DRAFT') {
    return c.json({ error: 'Only a draft session can import a statement' }, 409);
  }

  let parsed;
  try {
    parsed = parseStatementCsv(csv);
  } catch (err) {
    if (err instanceof StatementParseError) {
      // Nothing is written on a parse failure — a partially imported statement
      // produces a residual indistinguishable from a real discrepancy.
      return c.json({ error: `Line ${err.line}: ${err.message}` }, 400);
    }
    throw err;
  }

  // Deduping is by COUNT per line, not by presence.
  //
  // Two byte-identical CSV lines are not a mistake — a bank prints two rows when
  // you buy the same $3.29 item twice on one day, and that is common enough to
  // appear several times in a single statement. Treating the line as a unique
  // key silently dropped the second one, which then had nothing on the bank side
  // to pair with: the app's second transaction surfaced as an unexplained
  // leftover and, because its twin had matched, was reported as a probable
  // double entry. A correct transaction accused of being a duplicate is the
  // worst possible output here, and it originated three layers upstream.
  //
  // Counting preserves the reason the check exists — importing the same file
  // twice still adds nothing, because the stored count already covers it — while
  // letting a file that genuinely contains a line twice store it twice.
  const existing = await prisma.statementRow.findMany({
    where: { sessionId: id },
    select: { rawLine: true },
  });
  const stored = new Map<string, number>();
  for (const r of existing) stored.set(r.rawLine, (stored.get(r.rawLine) ?? 0) + 1);

  const incoming = new Map<string, number>();
  const fresh = parsed.rows.filter((r) => {
    const n = (incoming.get(r.rawLine) ?? 0) + 1;
    incoming.set(r.rawLine, n);
    return n > (stored.get(r.rawLine) ?? 0);
  });

  // The period must describe EVERY row the session holds, not just the file
  // that arrived last. Importing a second statement used to overwrite the window
  // with the new file's coverage while keeping the older rows, leaving the
  // session comparing a February statement against a July window — and the
  // residual sums app transactions through periodEnd, so that silently compares
  // two different spans.
  const period = await prisma.$transaction(async (tx) => {
    // No `skipDuplicates`: repeat lines are now legitimate rows, and the count
    // check above is the only thing deciding what gets written.
    await tx.statementRow.createMany({ data: fresh.map((r) => ({ ...r, sessionId: id })) });
    const bounds = await tx.statementRow.aggregate({
      where: { sessionId: id },
      _min: { postedDate: true },
    });
    // Only periodStart is derived — it is the matching window's start and must
    // cover the earliest statement row. periodEnd is the user's cutoff, set at
    // creation and via PATCH, and is NOT derived from the file: deriving it is
    // what welded the residual to the statement's last posted date and hid the
    // very activity the user needed inside the comparison. It stays as-is.
    const periodStart = bounds._min.postedDate ?? parsed.periodStart;
    await tx.reconciliationSession.update({
      where: { id },
      data: { periodStart },
    });
    return { periodStart, periodEnd: session.periodEnd };
  });

  return c.json(
    {
      imported: fresh.length,
      skippedDuplicates: parsed.rows.length - fresh.length,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
    },
    200,
  );
});

// ─── POST /:id/match ───

const matchRoute = createRoute({
  method: 'post',
  path: '/{id}/match',
  tags: ['Reconciliation'],
  summary: 'Run the matching engine and persist proposed matches',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      content: { 'application/json': { schema: RunMatchResultSchema } },
      description: 'Matched',
    },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not Found' },
    409: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Conflict' },
  },
});

app.openapi(matchRoute, async (c) => {
  const { id } = c.req.valid('param');

  const session = await prisma.reconciliationSession.findUnique({
    where: { id },
    include: { statementRows: true },
  });
  if (!session) return c.json({ error: 'Reconciliation session not found' }, 404);
  if (session.status !== 'DRAFT') {
    return c.json({ error: 'Only a draft session can be matched' }, 409);
  }

  /*
   * The period must cover every row the session holds, and matching is where
   * that gets enforced rather than assumed.
   *
   * The window decides which app transactions the matcher can even see, so a
   * period narrower than the rows silently starves it: a session holding five
   * months of statement lines under a two-week window loaded a fortnight of
   * transactions and reported every older line as missing from the app. That is
   * indistinguishable, on screen, from a hundred real discrepancies.
   *
   * Import already widens the period, but a session imported before that rule
   * existed keeps its stale window forever — nothing else recomputes it, and
   * re-importing the same file is a no-op that leaves it wrong. Recomputing
   * here means any such session heals the next time it is matched.
   */
  const bounds = await prisma.statementRow.aggregate({
    where: { sessionId: id },
    _min: { postedDate: true },
    _max: { postedDate: true },
  });
  const periodStart = bounds._min.postedDate ?? session.periodStart;
  // Only periodStart heals here — it must cover the earliest statement row or
  // matching starves. periodEnd is the user's cutoff and is never recomputed.
  if (periodStart.getTime() !== session.periodStart.getTime()) {
    await prisma.reconciliationSession.update({
      where: { id },
      data: { periodStart },
    });
  }

  const periodEnd = session.periodEnd;
  // The matcher's endDate is the cutoff — it decides whether an unmatched app
  // charge is recent enough to be pending vs. a genuine phantom, and "recent"
  // is measured against the moment the user is reconciling to.
  //
  // The LOAD window, though, must still cover every statement row even when the
  // cutoff predates the statement's last posted line, or those late rows come
  // back as missing-from-app — the false-discrepancy failure this whole feature
  // exists to avoid. So it runs to whichever of the two is later.
  const maxPosted = bounds._max.postedDate;
  const loadEnd = maxPosted && maxPosted.getTime() > periodEnd.getTime() ? maxPosted : periodEnd;

  const txs = await loadCandidateTransactions(session.accountId, {
    periodStart,
    periodEnd: loadEnd,
  });

  const statement: StatementLine[] = session.statementRows.map((r): StatementLine => {
    const amount = r.amount.toNumber();
    return {
      id: r.id,
      date: iso(r.transactionDate),
      description: r.description,
      amount: Math.abs(amount),
      direction: amount < 0 ? 'charge' : 'credit',
    };
  });

  const appTxs: AppTx[] = txs.map((t) => ({
    id: t.id,
    date: iso(t.date),
    name: t.name,
    amount: Math.abs(t.netAmount.toNumber()),
    direction: appTxDirection({
      type: t.type,
      inbound: t.toAccountId === session.accountId,
      tradeDirection: t.tradeDetail?.direction ?? null,
    }),
    // Lets the matcher pair a trade whose computed amount drifts a couple of
    // cents from the broker's settled figure — the one case where a statement
    // descriptor is too verbose for the name gate to ever be reachable.
    isTrade: t.type === 'TRADE',
  }));

  const result = reconcile({ statement, app: appTxs, endDate: iso(periodEnd) });

  // Persist only the pairings; the classification itself is recomputed on demand
  // so a re-run always reflects current data rather than a stale snapshot.
  //
  // Rows are identified by the id carried through the matcher, NOT by their
  // values. Keying on (date, description) collapsed every same-merchant charge
  // on a day into one entry — five Walmart charges became one row with five
  // matches and four rows reported as missing from the app.

  const toCreate: { statementRowId: string; transactionId: string; matchType: string }[] = [];
  for (const f of result.findings) {
    const kind = f.kind;
    const matchType =
      kind === 'matched' || kind === 'name_mismatch'
        ? 'EXACT'
        : kind === 'grouped_in_app' || kind === 'grouped_in_bank'
          ? 'SUM'
          : 'FUZZY';
    const pairable =
      kind === 'matched' ||
      kind === 'name_mismatch' ||
      kind === 'grouped_in_app' ||
      kind === 'grouped_in_bank' ||
      kind === 'amount_mismatch' ||
      kind === 'sign_flip' ||
      kind === 'date_far' ||
      kind === 'amount_differs';
    if (!pairable) continue;

    const lines = [...(f.statement ? [f.statement] : []), ...(f.statements ?? [])];
    const apps = [...(f.app ? [f.app] : []), ...(f.apps ?? [])];
    for (const line of lines) {
      const rowId = line.id;
      if (!rowId) continue;
      for (const a of apps) {
        toCreate.push({ statementRowId: rowId, transactionId: a.id, matchType });
      }
    }
  }

  // A MANUAL match is a decision the user made by hand; the automatic pass must
  // never overwrite it. Re-running match is a routine action (it happens after
  // every resolution), so wiping manual pairings here would silently destroy
  // work the user could not get back.
  const manual = await prisma.reconciliationMatch.findMany({
    where: { sessionId: id, matchType: 'MANUAL' },
    select: { statementRowId: true, transactionId: true },
  });
  const manualRows = new Set(manual.map((m) => m.statementRowId));
  const manualTxs = new Set(manual.map((m) => m.transactionId));

  // Anything a manual pairing already claims is off-limits to the auto pass —
  // otherwise a row could end up paired both ways at once.
  const autoCreate = toCreate.filter(
    (m) => !manualRows.has(m.statementRowId) && !manualTxs.has(m.transactionId),
  );

  await prisma.$transaction([
    prisma.reconciliationMatch.deleteMany({
      where: { sessionId: id, matchType: { not: 'MANUAL' } },
    }),
    prisma.reconciliationMatch.createMany({
      data: autoCreate.map((m) => ({ ...m, sessionId: id, matchType: m.matchType as never })),
      skipDuplicates: true,
    }),
  ]);

  return c.json(
    {
      matched: autoCreate.length + manual.length,
      unmatchedStatement: result.summary.missing_in_app ?? 0,
      unmatchedApp:
        (result.summary.missing_in_bank_phantom ?? 0) +
        (result.summary.missing_in_bank_pending ?? 0),
      summary: result.summary as Record<string, number>,
    },
    200,
  );
});

// ─── POST /:id/matches ───

const manualMatchRoute = createRoute({
  method: 'post',
  path: '/{id}/matches',
  tags: ['Reconciliation'],
  summary: 'Pair a statement row with a transaction by hand',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: CreateMatchSchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: ReconciliationMatchSchema } },
      description: 'Match created',
    },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not Found' },
    409: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Conflict' },
  },
});

app.openapi(manualMatchRoute, async (c) => {
  const { id } = c.req.valid('param');
  const { statementRowId, transactionId } = c.req.valid('json');

  const row = await prisma.statementRow.findFirst({ where: { id: statementRowId, sessionId: id } });
  if (!row) return c.json({ error: 'Statement row not found in this session' }, 404);

  const tx = await prisma.transaction.findUnique({ where: { id: transactionId } });
  if (!tx) return c.json({ error: 'Transaction not found' }, 404);

  try {
    const match = await prisma.reconciliationMatch.create({
      data: { sessionId: id, statementRowId, transactionId, matchType: 'MANUAL' },
    });
    return c.json(serializeMatch(match), 201);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return c.json({ error: 'These rows are already matched' }, 409);
    }
    throw err;
  }
});

// ─── DELETE /:id/matches/:matchId ───

const deleteMatchRoute = createRoute({
  method: 'delete',
  path: '/{id}/matches/{matchId}',
  tags: ['Reconciliation'],
  summary: 'Break a match',
  request: { params: z.object({ id: z.string(), matchId: z.string() }) },
  responses: {
    200: {
      content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
      description: 'Match removed',
    },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not Found' },
  },
});

app.openapi(deleteMatchRoute, async (c) => {
  const { id, matchId } = c.req.valid('param');
  const deleted = await prisma.reconciliationMatch.deleteMany({
    where: { id: matchId, sessionId: id },
  });
  if (deleted.count === 0) return c.json({ error: 'Match not found' }, 404);
  return c.json({ success: true }, 200);
});

// ─── POST /:id/abandon ───

const abandonRoute = createRoute({
  method: 'post',
  path: '/{id}/abandon',
  tags: ['Reconciliation'],
  summary: 'Abandon a session, deleting it and its scaffolding',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
      description: 'Abandoned and deleted',
    },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not Found' },
    409: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Conflict' },
  },
});

/**
 * Abandoning DELETES the session rather than marking it abandoned.
 *
 * A session is scaffolding for one sitting: its statement rows and pairings are
 * a parse of a CSV the user still has, rebuildable in seconds. Nothing in them
 * is a judgement — decisions the user actually made are written to the
 * transactions' notes precisely so they outlive the session that produced them.
 * Keeping the scaffolding therefore stores nothing and costs ~1,000 rows per
 * attempt; 28 abandoned sessions had accumulated 25,848 statement rows, none of
 * which any code read.
 *
 * The cascade does the work: StatementRow and ReconciliationMatch both cascade
 * from the session, and ReconciliationMatch additionally cascades from
 * StatementRow. Transactions do NOT cascade — a match holds a transaction, not
 * the reverse — so resolutions already applied are real ledger writes and
 * survive untouched. That is the property that must never regress, and it is
 * pinned by a test.
 *
 * A RECONCILED session is refused. Once a session closes, its rows are the
 * evidence of what was reconciled against and what the residual was at close —
 * the one case where they are not rebuildable, because the export may be gone.
 */
app.openapi(abandonRoute, async (c) => {
  const { id } = c.req.valid('param');
  const session = await prisma.reconciliationSession.findUnique({ where: { id } });
  if (!session) return c.json({ error: 'Reconciliation session not found' }, 404);
  if (session.status === 'RECONCILED') {
    return c.json({ error: 'A reconciled session cannot be abandoned' }, 409);
  }
  await prisma.reconciliationSession.delete({ where: { id } });
  return c.json({ success: true }, 200);
});

export default app;
