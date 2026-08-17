/**
 * Merge on combine (reconcile-merge).
 *
 * When the bank prints one line for several transactions the app recorded
 * separately, "Combine them" today writes only a pairing and leaves the ledger
 * holding N rows forever. This endpoint replaces those N rows with one parent
 * transaction at the bank's amount and date, split across the budgets the
 * originals carried — the existing `parentId` split model, which balance
 * calculation and budget aggregation already handle.
 *
 * The whole operation runs inside one `prisma.$transaction`: the deletes, the
 * parent create, the child allocations, and the match land together or not at
 * all. This is only atomic because the ledger gate and every lifecycle hook take
 * the transaction client (reconcile-merge task 1) — a half-completed merge would
 * leave the balance counting both the originals and the parent, which is exactly
 * the discrepancy the reconciler exists to surface.
 *
 * Ledger-gate note: this file is on the approved list because it creates child
 * allocations directly (`txc.transaction.create` — children carry `parentId`, do
 * not affect any account balance, and so are exempt from the gate, as in
 * `transactions.children.ts`). The balance-visible parent and the deletes go
 * through `ledgerCreate` / `ledgerDelete`.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { prisma } from '@budget-tracker/db';
import {
  MergeTransactionsSchema,
  MergeResultSchema,
  roundCurrency,
  sumCurrency,
} from '@budget-tracker/core';
import { ErrorSchema, createRouter } from '../lib/errors.js';
import { serializeMatch } from '../lib/reconciliation/serialization.js';
import { ledgerCreate, ledgerDelete } from '../lib/lifecycle/index.js';

const app = createRouter();

// ─── POST /:id/merge ───

const mergeRoute = createRoute({
  method: 'post',
  path: '/{id}/merge',
  tags: ['Reconciliation'],
  summary: 'Replace N transactions with one parent + child allocations, matched to a statement row',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: MergeTransactionsSchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: MergeResultSchema } },
      description: 'Merged',
    },
    400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Ineligible' },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not Found' },
    409: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Conflict' },
  },
});

app.openapi(mergeRoute, async (c) => {
  const { id } = c.req.valid('param');
  const { statementRowId, transactionIds, name } = c.req.valid('json');

  const session = await prisma.reconciliationSession.findUnique({ where: { id } });
  if (!session) return c.json({ error: 'Reconciliation session not found' }, 404);
  if (session.status !== 'DRAFT') {
    return c.json({ error: 'Only a draft session can merge transactions' }, 409);
  }

  const row = await prisma.statementRow.findFirst({ where: { id: statementRowId, sessionId: id } });
  if (!row) return c.json({ error: 'Statement row not found in this session' }, 404);

  // De-dup so a repeated id cannot be counted (or deleted) twice.
  const uniqueIds = [...new Set(transactionIds)];
  const originals = await prisma.transaction.findMany({ where: { id: { in: uniqueIds } } });
  if (originals.length !== uniqueIds.length) {
    return c.json({ error: 'One or more transactions were not found' }, 404);
  }

  // ─── Eligibility (Requirement 1) ───
  // Same-type only: the split model stores each child with the parent's single
  // type and drives the remainder to zero, so a mixed EXPENSE+REFUND set cannot
  // be represented without counting a refund as spending. INCOME/TRANSFER are
  // excluded for the same reason a free-form correction is — different balance
  // semantics — and stay pairings.
  for (const t of originals) {
    if (t.type !== 'EXPENSE' && t.type !== 'REFUND') {
      return c.json(
        { error: `"${t.name}" is a ${t.type}; only expense and refund transactions can be merged` },
        400,
      );
    }
    if (t.parentId) {
      return c.json({ error: `"${t.name}" is already part of a split and cannot be merged` }, 400);
    }
    if (t.accountId !== session.accountId) {
      return c.json({ error: `"${t.name}" is not on the account being reconciled` }, 400);
    }
    if (roundCurrency(Number(t.amount)) === 0) {
      return c.json(
        { error: `"${t.name}" has a zero amount and cannot become a child allocation` },
        400,
      );
    }
  }
  const type = originals[0]!.type;
  if (originals.some((t) => t.type !== type)) {
    return c.json(
      { error: 'A merge must be all expenses or all refunds, not a mix of the two' },
      400,
    );
  }

  // The parent carries the bank line's amount, so the selected rows must sum to
  // it or the merge would not be balance-neutral (Requirement 3.7). A genuine
  // combination decision always sums exactly; this guards direct API misuse.
  const originalsSum = sumCurrency(originals.map((t) => Number(t.amount)));
  const rowMagnitude = Math.abs(roundCurrency(Number(row.amount)));
  if (Math.abs(originalsSum - rowMagnitude) > 0.005) {
    return c.json(
      {
        error: `The selected transactions sum to ${originalsSum}, which does not match the statement line of ${rowMagnitude}`,
      },
      400,
    );
  }

  // A null-budget child needs the Uncategorized system budget substituted
  // (Requirement 3.3) — the gate does this for the parent automatically, but the
  // children are created directly here.
  const uncategorized = await prisma.budget.findFirst({
    where: { name: 'Uncategorized', isSystem: true },
    select: { id: true },
  });
  if (!uncategorized) throw new Error('Uncategorized system budget is missing');

  // Read each original's debt payment BEFORE the transaction: deleting a
  // transaction nullifies DebtPayment.transactionId (onDelete: SetNull), so the
  // reversal hook cannot find it afterwards — it must be handed in.
  const debtPayments = await prisma.debtPayment.findMany({
    where: { transactionId: { in: uniqueIds } },
    include: { debt: true },
  });
  const debtByTx = new Map(debtPayments.map((p) => [p.transactionId!, p]));

  // One original's budget becomes the parent's own allocation (its remainder);
  // only the OTHERS become children. So the split holds exactly the budgets the
  // rows carried — no $0 remainder category, ever. Which original is the parent is
  // cosmetic (every budget still receives its exact amount, since the remainder
  // parent.amount − SUM(children) equals the head's amount toward the head's
  // budget), but prefer one that HAS a budget so Uncategorized surfaces only for a
  // genuinely un-budgeted row — never as an empty $0 remainder.
  const head = originals.find((t) => t.budgetId != null) ?? originals[0]!;
  const rest = originals.filter((t) => t.id !== head.id);
  const headDate = head.date.toISOString().slice(0, 10);

  const result = await prisma.$transaction(
    async (txc) => {
      // Delete every original through the gate so its reversal hooks fire — the
      // balance chain, a schedule un-match, a debt reversal — inside this
      // transaction, and roll back with it on any failure.
      for (const t of originals) {
        const dp = debtByTx.get(t.id);
        await ledgerDelete(t.id, dp ? { debtPayment: dp } : undefined, txc);
      }

      // The parent: the bank's amount and posted date, the chosen name, the
      // account being reconciled, and the first original's budget as its remainder
      // (the gate falls back to Uncategorized only if that row genuinely had
      // none — a non-zero Uncategorized portion, never a $0 one). Its name+date
      // are preserved in the note, like the children.
      const parent = await ledgerCreate(
        {
          type,
          name,
          amount: rowMagnitude,
          date: row.postedDate,
          accountId: session.accountId,
          budgetId: head.budgetId,
          note: `${head.name} · ${headDate}`,
        },
        txc,
      );

      // One child per REMAINING original: its own amount and budget, with its name
      // and date preserved in the note (a child has neither field of its own).
      for (const t of rest) {
        const childAmount = roundCurrency(Number(t.amount));
        const origDate = t.date.toISOString().slice(0, 10);
        await txc.transaction.create({
          data: {
            parentId: parent.id,
            type,
            name: parent.name,
            amount: childAmount,
            netAmount: childAmount,
            date: parent.date,
            accountId: parent.accountId,
            budgetId: t.budgetId ?? uncategorized.id,
            note: `${t.name} · ${origDate}`,
          },
        });
      }

      const match = await txc.reconciliationMatch.create({
        data: { sessionId: id, statementRowId, transactionId: parent.id, matchType: 'MANUAL' },
      });

      return { parentId: parent.id, childCount: rest.length, match };
    },
    { timeout: 30_000 },
  );

  return c.json(
    {
      parentTransactionId: result.parentId,
      childCount: result.childCount,
      match: serializeMatch(result.match),
    },
    201,
  );
});

export default app;
