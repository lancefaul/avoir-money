/**
 * Closing a reconciliation, and the escape hatch.
 *
 * This is the enforcement point for the rule the whole feature exists to impose:
 * **a session cannot be closed while the residual is non-zero.** That rule is
 * what forces a transaction correction to be paired with the opening correction
 * that was compensating for it — fix only one side and the residual becomes
 * non-zero, the close is refused, and the second error is exposed.
 *
 * The escape hatch does NOT relax that rule. It creates a real, visible,
 * reasoned transaction that brings the residual to zero honestly. It must never
 * adjust `openingBalance`: an escape hatch that moved the opening would let the
 * user close without fixing anything, recreating the exact bug this feature was
 * built to catch.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { prisma } from '@budget-tracker/db';
import {
  CloseSessionResultSchema,
  CreateAdjustmentSchema,
  ReconciliationSessionSchema,
  ResidualSchema,
} from '@budget-tracker/core';
import { ErrorSchema, createRouter } from '../lib/errors.js';
import { computeResidual, RESIDUAL_EPSILON } from '../lib/reconciliation/residual.js';
import { serializeSession } from '../lib/reconciliation/serialization.js';
import { ledgerCreate } from '../lib/lifecycle/index.js';

const app = createRouter();

const round2 = (n: number): number => Math.round(n * 100) / 100;

// ─── POST /:id/adjustment ───

const adjustmentRoute = createRoute({
  method: 'post',
  path: '/{id}/adjustment',
  tags: ['Reconciliation'],
  summary: 'Create the escape-hatch adjustment for an unexplainable residual',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: CreateAdjustmentSchema } } },
  },
  responses: {
    201: {
      content: {
        'application/json': {
          schema: z.object({ session: ReconciliationSessionSchema, residual: ResidualSchema }),
        },
      },
      description: 'Adjustment created',
    },
    400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Bad Request' },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not Found' },
    409: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Conflict' },
  },
});

app.openapi(adjustmentRoute, async (c) => {
  const { id } = c.req.valid('param');
  const { reason } = c.req.valid('json');

  const session = await prisma.reconciliationSession.findUnique({ where: { id } });
  if (!session) return c.json({ error: 'Reconciliation session not found' }, 404);
  if (session.status !== 'DRAFT') {
    return c.json({ error: 'Only a draft session can take an adjustment' }, 409);
  }
  if (session.adjustmentTransactionId) {
    return c.json({ error: 'This session already has an adjustment' }, 409);
  }

  const before = await computeResidual(id);
  if (!before) return c.json({ error: 'Reconciliation session not found' }, 404);
  if (before.isBalanced) {
    // Refusing here is deliberate: an adjustment on a balanced session is a
    // meaningless artifact in the register that would later read as a real
    // discrepancy someone papered over.
    return c.json({ error: 'Residual is already zero — no adjustment is needed' }, 400);
  }

  // A positive residual means the bank holds more than the app accounts for, so
  // the adjustment must credit the account; a negative residual debits it.
  const amount = round2(Math.abs(before.residual));
  const type = before.residual > 0 ? 'INCOME' : 'EXPENSE';

  const adjustment = await ledgerCreate({
    type,
    name: `Reconciliation adjustment — ${reason}`,
    amount,
    date: session.periodEnd,
    accountId: session.accountId,
    note: reason,
  });

  const updated = await prisma.reconciliationSession.update({
    where: { id },
    data: { adjustmentTransactionId: adjustment.id, adjustmentReason: reason },
  });

  const after = await computeResidual(id);
  return c.json({ session: serializeSession(updated), residual: after! }, 201);
});

// ─── POST /:id/close ───

const closeRoute = createRoute({
  method: 'post',
  path: '/{id}/close',
  tags: ['Reconciliation'],
  summary: 'Close a session as reconciled',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      content: { 'application/json': { schema: CloseSessionResultSchema } },
      description: 'Closed',
    },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not Found' },
    409: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Residual is not zero, or the ledger invariant does not hold',
    },
  },
});

app.openapi(closeRoute, async (c) => {
  const { id } = c.req.valid('param');

  const session = await prisma.reconciliationSession.findUnique({ where: { id } });
  if (!session) return c.json({ error: 'Reconciliation session not found' }, 404);
  if (session.status !== 'DRAFT') {
    return c.json({ error: 'Only a draft session can be closed' }, 409);
  }

  // Recomputed from live data, never taken from the client. The entire
  // guarantee of this endpoint rests on this figure being current.
  const residual = await computeResidual(id);
  if (!residual) return c.json({ error: 'Reconciliation session not found' }, 404);

  if (!residual.isBalanced) {
    return c.json(
      {
        error:
          `Cannot close: ${residual.residual.toFixed(2)} is unaccounted for. ` +
          'Resolve the remaining differences, or record an adjustment with a reason.',
        details: residual,
      },
      409,
    );
  }

  // The invariant must hold for the account before this period is declared
  // reconciled — closing on top of a broken ledger would certify it as correct.
  const account = await prisma.account.findUniqueOrThrow({
    where: { id: session.accountId },
    select: { balance: true, openingBalance: true },
  });
  const sums = await prisma.$queryRaw<{ total: string | null }[]>`
    SELECT SUM(
      CASE
        WHEN t.type IN ('INCOME', 'REFUND') THEN t."netAmount"
        WHEN t.type = 'EXPENSE' THEN -t."netAmount"
        WHEN t.type = 'TRANSFER' AND t."toAccountId" = ${session.accountId} THEN t."netAmount"
        WHEN t.type = 'TRANSFER' THEN -t."netAmount"
        WHEN t.type = 'TRADE' AND td.direction = 'BUY' THEN -t."netAmount"
        WHEN t.type = 'TRADE' AND td.direction = 'SELL' THEN t."netAmount"
        ELSE 0
      END
    )::text AS total
    FROM "Transaction" t
    LEFT JOIN "TradeDetail" td ON td."transactionId" = t.id
    WHERE t."parentId" IS NULL
      AND (t."accountId" = ${session.accountId}
           OR (t."toAccountId" = ${session.accountId} AND t.type = 'TRANSFER'))
  `;
  const expected = round2(Number(account.openingBalance) + Number(sums[0]?.total ?? 0));
  if (Math.abs(Number(account.balance) - expected) >= RESIDUAL_EPSILON) {
    return c.json(
      {
        error:
          "Cannot close: this account's stored balance disagrees with the sum of its " +
          'transactions. Run the ledger integrity check before reconciling.',
      },
      409,
    );
  }

  const matches = await prisma.reconciliationMatch.findMany({
    where: { sessionId: id },
    select: { transactionId: true },
  });
  const matchedIds = [...new Set(matches.map((m) => m.transactionId))];
  const now = new Date();

  const [, updated] = await prisma.$transaction([
    prisma.transaction.updateMany({
      where: { id: { in: matchedIds } },
      data: { reconciledAt: now },
    }),
    prisma.reconciliationSession.update({
      where: { id },
      data: {
        status: 'RECONCILED',
        reconciledAt: now,
        residualAtClose: residual.residual,
      },
    }),
  ]);

  return c.json(
    {
      session: serializeSession(updated),
      residual,
      clearedTransactions: matchedIds.length,
    },
    200,
  );
});

export default app;
