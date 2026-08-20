/**
 * Create a purchase — paid from one account, or split across several.
 *
 * One payment is the ordinary single-transaction path, unchanged. Two or more
 * become a **purchase group** (payment-split, ADR-030): a balance-neutral Anchor
 * carrying the budget (`accountId = null`), plus one balance-visible leg per
 * account, all sharing a `purchaseGroupId` and written inside one
 * `prisma.$transaction` through the ledger gate — so the group commits or rolls
 * back as a unit and every account balance stays consistent.
 *
 * The account never touches the budget: the budget lives on the Anchor, and each
 * leg carries the system "Payment" allocation (excluded from budget rollup like
 * TRANSFER), so how a purchase was tendered never distorts what it was for.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { randomUUID } from 'node:crypto';
import { prisma } from '@budget-tracker/db';
import {
  CreatePurchaseSchema,
  CreatePurchaseResultSchema,
  UpdatePurchasePaymentsSchema,
  roundCurrency,
  sumCurrency,
} from '@budget-tracker/core';
import { ledgerCreate, ledgerDelete } from '../lib/lifecycle/index.js';
import { ErrorSchema, createRouter } from '../lib/errors.js';

const app = createRouter();

const createPurchaseRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Transactions'],
  summary: 'Create a purchase (single account, or split across accounts as a group)',
  request: {
    body: { content: { 'application/json': { schema: CreatePurchaseSchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: CreatePurchaseResultSchema } },
      description: 'Created',
    },
    400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Bad Request' },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not Found' },
  },
});

app.openapi(createPurchaseRoute, async (c) => {
  const body = c.req.valid('json');

  // Every funding account must exist.
  const accountIds = [...new Set(body.payments.map((p) => p.accountId))];
  const found = await prisma.account.findMany({
    where: { id: { in: accountIds } },
    select: { id: true },
  });
  if (found.length !== accountIds.length) {
    return c.json({ error: 'One or more funding accounts not found' }, 404);
  }

  // ── Single account: the ordinary transaction path, unchanged ──
  if (body.payments.length === 1) {
    const p = body.payments[0]!;
    const tx = await ledgerCreate({
      type: 'EXPENSE',
      name: body.name,
      amount: body.amount,
      date: body.date,
      accountId: p.accountId,
      budgetId: body.budgetId ?? null,
      note: body.note ?? null,
    });
    return c.json({ purchaseGroupId: null, transactionIds: [tx.id] }, 201);
  }

  // ── Split: a purchase group (Anchor + legs), written atomically ──
  const groupId = randomUUID();
  // Legs carry the system "Payment" allocation so they are money movement, not
  // spend; the budget lives on the Anchor. Absent (fresh test DB) → the leg falls
  // to the ledger gate's Uncategorized default, which is harmless here.
  const paymentBudget = await prisma.budget.findFirst({
    where: { name: 'Payment', isSystem: true },
    select: { id: true },
  });

  const transactionIds = await prisma.$transaction(async (tx) => {
    const anchor = await ledgerCreate(
      {
        type: 'EXPENSE',
        name: body.name,
        amount: body.amount, // the purchase total
        date: body.date,
        accountId: null, // balance-neutral: no account to move
        budgetId: body.budgetId ?? null, // the purchase's budget lives on the Anchor
        note: body.note ?? null,
        purchaseGroupId: groupId,
      },
      tx,
    );

    const legIds: string[] = [];
    for (const p of body.payments) {
      const leg = await ledgerCreate(
        {
          type: 'EXPENSE',
          name: body.name,
          amount: p.amount,
          date: body.date,
          accountId: p.accountId, // balance moves here
          budgetId: paymentBudget?.id ?? null, // system Payment allocation
          note: body.note ?? null,
          purchaseGroupId: groupId,
        },
        tx,
      );
      legIds.push(leg.id);
    }
    return [anchor.id, ...legIds];
  });

  return c.json({ purchaseGroupId: groupId, transactionIds }, 201);
});

// ─── DELETE /{groupId} — remove a whole group, reversing balances ───

const deletePurchaseRoute = createRoute({
  method: 'delete',
  path: '/{groupId}',
  tags: ['Transactions'],
  summary: 'Delete a purchase group (Anchor + every leg), reversing each account balance',
  request: { params: z.object({ groupId: z.string() }) },
  responses: {
    200: {
      content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
      description: 'Deleted',
    },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not Found' },
  },
});

app.openapi(deletePurchaseRoute, async (c) => {
  const { groupId } = c.req.valid('param');
  const rows = await prisma.transaction.findMany({
    where: { purchaseGroupId: groupId },
    select: { id: true },
  });
  if (rows.length === 0) return c.json({ error: 'Purchase group not found' }, 404);

  // Delete every member through the gate so each leg's balance is reversed; the
  // Anchor's delete is a no-op on balances (no account). Atomic — a failure
  // leaves the group whole rather than half-deleted with a dangling balance.
  await prisma.$transaction(async (tx) => {
    for (const r of rows) await ledgerDelete(r.id, undefined, tx);
  });

  return c.json({ success: true }, 200);
});

// ─── PUT /{groupId}/payments — re-split the payment, budget untouched ───

const updatePaymentsRoute = createRoute({
  method: 'put',
  path: '/{groupId}/payments',
  tags: ['Transactions'],
  summary: "Replace a group's payment legs; the Anchor and its budget are untouched",
  request: {
    params: z.object({ groupId: z.string() }),
    body: { content: { 'application/json': { schema: UpdatePurchasePaymentsSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: CreatePurchaseResultSchema } },
      description: 'Updated',
    },
    400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Bad Request' },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not Found' },
  },
});

app.openapi(updatePaymentsRoute, async (c) => {
  const { groupId } = c.req.valid('param');
  const { payments } = c.req.valid('json');

  const rows = await prisma.transaction.findMany({ where: { purchaseGroupId: groupId } });
  const anchor = rows.find((r) => r.accountId === null);
  if (!anchor) return c.json({ error: 'Purchase group not found' }, 404);
  const oldLegs = rows.filter((r) => r.accountId !== null);

  // The new legs must still cover the Anchor's total. Checked here, against the
  // stored Anchor, because the schema cannot know the total.
  const netAmount = roundCurrency(Number(anchor.amount));
  const paid = sumCurrency(payments.map((p) => p.amount));
  if (paid !== netAmount) {
    return c.json(
      {
        error: `payment legs must sum to the net amount ${netAmount.toFixed(2)} (got ${paid.toFixed(2)})`,
      },
      400,
    );
  }

  const accountIds = [...new Set(payments.map((p) => p.accountId))];
  const found = await prisma.account.findMany({
    where: { id: { in: accountIds } },
    select: { id: true },
  });
  if (found.length !== accountIds.length) {
    return c.json({ error: 'One or more funding accounts not found' }, 404);
  }

  const paymentBudget = await prisma.budget.findFirst({
    where: { name: 'Payment', isSystem: true },
    select: { id: true },
  });

  // Replace the legs, keeping the Anchor (and thus the budget) intact — one
  // atomic swap so no account is ever left counting a removed leg. Legs inherit
  // the Anchor's name/date/note.
  const legIds = await prisma.$transaction(async (tx) => {
    for (const leg of oldLegs) await ledgerDelete(leg.id, undefined, tx);
    const ids: string[] = [];
    for (const p of payments) {
      const leg = await ledgerCreate(
        {
          type: 'EXPENSE',
          name: anchor.name,
          amount: p.amount,
          date: anchor.date,
          accountId: p.accountId,
          budgetId: paymentBudget?.id ?? null,
          note: anchor.note,
          purchaseGroupId: groupId,
        },
        tx,
      );
      ids.push(leg.id);
    }
    return ids;
  });

  return c.json({ purchaseGroupId: groupId, transactionIds: [anchor.id, ...legIds] }, 200);
});

export default app;
