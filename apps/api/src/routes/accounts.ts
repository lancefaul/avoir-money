import { createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { prisma, Prisma } from '@budget-tracker/db';
import {
  AccountSchema,
  CreateAccountSchema,
  CreateRewardsAccountSchema,
  UpdateAccountSchema,
} from '@budget-tracker/core';
import { ErrorSchema, createRouter } from '../lib/errors.js';
import { recalculateAccountBalance, rebuildBalanceChain } from '../lib/account-balance.js';

type Account = z.infer<typeof AccountSchema>;

const app = createRouter();

function serializeAccount(a: {
  id: string;
  name: string;
  type: string;
  balance: { toNumber(): number };
  openingBalance: { toNumber(): number };
  archived: boolean;
  hasRewards: boolean;
  parentAccountId: string | null;
  earnsInterest: boolean;
  interestRate: { toNumber(): number };
  interestRateType: string;
  brand: string | null;
  createdAt: Date;
  updatedAt: Date;
}): Account {
  return {
    id: a.id,
    name: a.name,
    type: a.type as Account['type'],
    brand: a.brand as Account['brand'],
    balance: Number(a.balance),
    openingBalance: Number(a.openingBalance),
    archived: a.archived,
    hasRewards: a.hasRewards,
    parentAccountId: a.parentAccountId,
    earnsInterest: a.earnsInterest,
    interestRate: Number(a.interestRate),
    interestRateType: a.interestRateType as Account['interestRateType'],
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

// ─── GET / ───

const listAccountsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Accounts'],
  summary: 'List all accounts',
  request: {
    query: z.object({
      earnsInterest: z.enum(['true', 'false']).optional(),
    }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(AccountSchema) } },
      description: 'List of accounts',
    },
  },
});

app.openapi(listAccountsRoute, async (c) => {
  const { earnsInterest } = c.req.valid('query');
  const where: Record<string, unknown> = {};
  if (earnsInterest === 'true') where.earnsInterest = true;
  else if (earnsInterest === 'false') where.earnsInterest = false;

  const accounts = await prisma.account.findMany({
    where,
    orderBy: { name: 'asc' },
  });
  return c.json(accounts.map(serializeAccount), 200);
});

// ─── POST / ───

const createAccountRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Accounts'],
  summary: 'Create an account',
  request: {
    body: { content: { 'application/json': { schema: CreateAccountSchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: AccountSchema } },
      description: 'Account created',
    },
    400: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Bad Request',
    },
    409: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Conflict',
    },
  },
});

app.openapi(createAccountRoute, async (c) => {
  const body = c.req.valid('json');
  // A rewards account only makes sense nested under a card. Route it through the
  // dedicated endpoint so it always gets a parent — a parentless Rewards account
  // would be an orphan the nested-card UI can never render.
  if (body.type === 'Rewards') {
    return c.json({ error: 'Create rewards accounts via POST /accounts/:id/rewards-account' }, 400);
  }
  try {
    // The form's "Starting Balance" arrives as `balance`. A new account has no
    // transactions, so opening and balance are equal by definition — recording
    // both is what keeps the starting figure recoverable once transactions
    // begin moving `balance`. `openingBalance` may also be sent explicitly
    // (editing a known pre-tracking balance); that wins when present.
    const account = await prisma.account.create({
      data: { ...body, openingBalance: body.openingBalance ?? body.balance ?? 0 },
    });
    return c.json(serializeAccount(account), 201);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002')
        return c.json({ error: 'Duplicate record', details: err.meta }, 409);
    }
    throw err;
  }
});

// ─── GET /:id ───

const getAccountRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Accounts'],
  summary: 'Get account by ID',
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: AccountSchema } },
      description: 'Account found',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
  },
});

app.openapi(getAccountRoute, async (c) => {
  const { id } = c.req.valid('param');
  const account = await prisma.account.findUnique({ where: { id } });
  if (!account) {
    return c.json({ error: 'Account not found' }, 404);
  }
  return c.json(serializeAccount(account), 200);
});

// ─── PUT /:id ───

const updateAccountRoute = createRoute({
  method: 'put',
  path: '/{id}',
  tags: ['Accounts'],
  summary: 'Update an account',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: UpdateAccountSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: AccountSchema } },
      description: 'Account updated',
    },
    400: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Bad Request',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
    409: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Conflict',
    },
  },
});

app.openapi(updateAccountRoute, async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');
  try {
    // `openingBalance` is updatable, but it can never be written on its own.
    // The ledger invariant is openingBalance + SUM(transactions) == balance, and
    // the transaction sum does not change here — so moving the opening by Δ must
    // move `balance` by Δ too, and shift every balanceBefore/balanceAfter in the
    // chain. rebuildBalanceChain does exactly that: it re-seeds from the stored
    // opening and writes the recomputed running total back to the account.
    // Writing the opening without it would break the invariant on every edit.
    const { openingBalance, ...updatable } = body;

    const existing = await prisma.account.findUniqueOrThrow({ where: { id } });
    const openingChanged =
      openingBalance !== undefined &&
      Math.abs(openingBalance - Number(existing.openingBalance)) > 0.005;

    const account = await prisma.account.update({
      where: { id },
      data: openingChanged ? { ...updatable, openingBalance } : updatable,
    });

    if (openingChanged) {
      await rebuildBalanceChain(id);
      // Re-read: rebuildBalanceChain rewrote `balance`, so the row captured above
      // is already stale and would report the pre-shift figure to the client.
      const rebuilt = await prisma.account.findUniqueOrThrow({ where: { id } });
      return c.json(serializeAccount(rebuilt), 200);
    }

    return c.json(serializeAccount(account), 200);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return c.json({ error: 'Account not found' }, 404);
      if (err.code === 'P2002')
        return c.json({ error: 'Duplicate record', details: err.meta }, 409);
    }
    throw err;
  }
});

export default app;

// ─── GET /:id/transaction-count ───
const txCountRoute = createRoute({
  method: 'get',
  path: '/{id}/transaction-count',
  tags: ['Accounts'],
  summary: 'Get transaction count for account',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      content: { 'application/json': { schema: z.object({ count: z.number() }) } },
      description: 'Count',
    },
  },
});
app.openapi(txCountRoute, async (c) => {
  const { id } = c.req.valid('param');
  const count = await prisma.transaction.count({
    where: { OR: [{ accountId: id }, { toAccountId: id }] },
  });
  return c.json({ count }, 200);
});

// ─── POST /:id/archive ───
const archiveRoute = createRoute({
  method: 'post',
  path: '/{id}/archive',
  tags: ['Accounts'],
  summary: 'Archive an account',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { content: { 'application/json': { schema: AccountSchema } }, description: 'Archived' },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not Found' },
  },
});
app.openapi(archiveRoute, async (c) => {
  const { id } = c.req.valid('param');
  try {
    const account = await prisma.account.update({ where: { id }, data: { archived: true } });
    return c.json(serializeAccount(account), 200);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return c.json({ error: 'Account not found' }, 404);
    }
    throw err;
  }
});

// ─── POST /:id/unarchive ───
const unarchiveRoute = createRoute({
  method: 'post',
  path: '/{id}/unarchive',
  tags: ['Accounts'],
  summary: 'Unarchive an account',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { content: { 'application/json': { schema: AccountSchema } }, description: 'Unarchived' },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not Found' },
  },
});
app.openapi(unarchiveRoute, async (c) => {
  const { id } = c.req.valid('param');
  try {
    const account = await prisma.account.update({ where: { id }, data: { archived: false } });
    return c.json(serializeAccount(account), 200);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return c.json({ error: 'Account not found' }, 404);
    }
    throw err;
  }
});

// ─── DELETE /:id ───
const deleteAccountRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Accounts'],
  summary: 'Delete account and all transactions',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'Deleted' },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not Found' },
  },
});
app.openapi(deleteAccountRoute, async (c) => {
  const { id } = c.req.valid('param');
  try {
    // A rewards-enabled card owns a nested rewards account (CardRewards,
    // onDelete: Cascade). Deleting the card cascade-deletes that child — but the
    // child's own rows (earned credits, redeemed legs) reference it via
    // Transaction.accountId (onDelete: Restrict), which would block the cascade
    // with an FK violation once any reward has been earned or redeemed. Clear the
    // child's transactions here too so the cascade can complete.
    const rewardsChild = await prisma.account.findUnique({
      where: { parentAccountId: id },
      select: { id: true },
    });
    const accountIds = rewardsChild ? [id, rewardsChild.id] : [id];
    await prisma.transaction.deleteMany({
      where: {
        OR: [{ accountId: { in: accountIds } }, { toAccountId: { in: accountIds } }],
      },
    });
    await prisma.expense.updateMany({ where: { accountId: id }, data: { accountId: null } });
    await prisma.income.updateMany({ where: { accountId: id }, data: { accountId: null } });
    await prisma.account.delete({ where: { id } });
    return c.body(null, 204);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return c.json({ error: 'Account not found' }, 404);
    }
    throw err;
  }
});

// ─── POST /:id/recalculate-balance ───

const RecalculateBalanceResponseSchema = z.object({
  oldBalance: z.number(),
  newBalance: z.number(),
  difference: z.number(),
});

const recalculateBalanceRoute = createRoute({
  method: 'post',
  path: '/{id}/recalculate-balance',
  tags: ['Accounts'],
  summary: 'Recalculate account balance from transactions',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      content: { 'application/json': { schema: RecalculateBalanceResponseSchema } },
      description: 'Balance recalculated',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
  },
});

app.openapi(recalculateBalanceRoute, async (c) => {
  const { id } = c.req.valid('param');
  const result = await recalculateAccountBalance(id);
  if (!result) return c.json({ error: 'Account not found' }, 404);
  return c.json(result, 200);
});

// ─── POST /:id/rebuild-balance-chain ───

const RebuildChainResponseSchema = z.object({
  updatedTransactions: z.number(),
  finalBalance: z.number(),
});

const rebuildBalanceChainRoute = createRoute({
  method: 'post',
  path: '/{id}/rebuild-balance-chain',
  tags: ['Accounts'],
  summary: 'Rebuild the full balanceBefore/balanceAfter chain for an account',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      content: { 'application/json': { schema: RebuildChainResponseSchema } },
      description: 'Chain rebuilt',
    },
    404: {
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      description: 'Account not found',
    },
  },
});

app.openapi(rebuildBalanceChainRoute, async (c) => {
  const { id } = c.req.valid('param');
  const result = await rebuildBalanceChain(id);
  if (!result) return c.json({ error: 'Account not found' }, 404);
  return c.json(result, 200);
});

// ─── POST /:id/rewards-account ───

const createRewardsAccountRoute = createRoute({
  method: 'post',
  path: '/{id}/rewards-account',
  tags: ['Accounts'],
  summary: 'Create a rewards account nested under a card',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: CreateRewardsAccountSchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: AccountSchema } },
      description: 'Rewards account created',
    },
    400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Bad Request' },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Parent account not found',
    },
    409: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Parent already has a rewards account',
    },
  },
});

app.openapi(createRewardsAccountRoute, async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');
  const parent = await prisma.account.findUnique({ where: { id } });
  if (!parent) return c.json({ error: 'Account not found' }, 404);
  if (parent.type === 'Rewards') {
    return c.json({ error: 'A rewards account cannot own another rewards account' }, 400);
  }
  // No transactions yet, so opening == balance by definition (same rule as the
  // generic create). The bake-in migration seeds this with the carried balance.
  const opening = body.openingBalance ?? 0;
  try {
    const account = await prisma.account.create({
      data: {
        name: body.name ?? `${parent.name} Rewards`,
        type: 'Rewards',
        parentAccountId: id,
        openingBalance: opening,
        balance: opening,
      },
    });
    return c.json(serializeAccount(account), 201);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // parentAccountId is @unique — one rewards account per card.
      if (err.code === 'P2002') {
        return c.json({ error: 'This account already has a rewards account' }, 409);
      }
    }
    throw err;
  }
});
