/**
 * Guard tests for Account.openingBalance and the ledger invariant (2026-07-18).
 *
 * Background: the account create form has always had a "Starting Balance" field,
 * but it wrote straight into `Account.balance` — the same column transactions
 * then mutate. Once the first transaction landed, the starting figure was
 * unrecoverable. `recalculateAccountBalance` compounded it by summing from zero,
 * so calling it silently erased the starting balance: on the Prime Visa card
 * that was a 4,930.64 swing.
 *
 * Worse, nothing noticed. The balance chain's backward-rebuild script anchors on
 * the stored balance and parks the leftover in the earliest row's balanceBefore,
 * so a wrong balance was quietly reclassified as "this account had history before
 * tracking" — which is how a reversed a four-figure sum card payment hid for four months.
 *
 * The invariant these tests defend:
 *
 *     openingBalance + SUM(transactions) == balance
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@budget-tracker/db';
import { post, put, req } from '../test/helpers.js';
import { recalculateAccountBalance, rebuildBalanceChain } from '../lib/account-balance.js';
import { ledgerCreate } from '../lib/lifecycle/index.js';

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    await prisma.$connect();
  }
});

const utc = (d: number) => new Date(Date.UTC(2026, 6, d));

describe('POST /accounts — Starting Balance', () => {
  it('records the starting balance in openingBalance as well as balance', async () => {
    const res = await post('/accounts', {
      name: `__opening_${Date.now()}`,
      type: 'Checking',
      balance: 250.75,
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; balance: number; openingBalance: number };
    expect(body.balance).toBe(250.75);
    expect(body.openingBalance).toBe(250.75);

    const row = await prisma.account.findUniqueOrThrow({ where: { id: body.id } });
    expect(Number(row.openingBalance)).toBe(250.75);
  });

  it('defaults openingBalance to 0 when no starting balance is given', async () => {
    const res = await post('/accounts', { name: `__opening_zero_${Date.now()}`, type: 'Checking' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { openingBalance: number; balance: number };
    expect(body.openingBalance).toBe(0);
    expect(body.balance).toBe(0);
  });

  it('honours an explicit openingBalance over the balance field', async () => {
    // Correcting a known pre-tracking balance: the two legitimately differ.
    const res = await post('/accounts', {
      name: `__opening_explicit_${Date.now()}`,
      type: 'Credit Card',
      balance: -100,
      openingBalance: -34.55,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { openingBalance: number; balance: number };
    expect(body.openingBalance).toBe(-34.55);
    expect(body.balance).toBe(-100);
  });
});

describe('recalculateAccountBalance seeds from openingBalance', () => {
  it('preserves the starting balance instead of summing from zero', async () => {
    // The exact regression: before the fix this returned 0 + transactions,
    // discarding the 500 opening entirely.
    const account = await prisma.account.create({
      data: {
        name: `__recalc_${Date.now()}`,
        type: 'CHECKING',
        balance: 500,
        openingBalance: 500,
      },
    });

    await ledgerCreate({
      type: 'EXPENSE',
      name: '__opening_expense',
      amount: 120.5,
      date: utc(1),
      accountId: account.id,
    });

    const result = await recalculateAccountBalance(account.id);
    expect(result).not.toBeNull();
    expect(result!.newBalance).toBe(379.5); // 500 - 120.50, not -120.50
    expect(result!.difference).toBe(0); // hook already had it right

    const row = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(Number(row.balance)).toBe(379.5);
  });

  it('is idempotent — recalculating twice does not drift', async () => {
    const account = await prisma.account.create({
      data: { name: `__recalc2_${Date.now()}`, type: 'CHECKING', balance: 80, openingBalance: 80 },
    });
    await ledgerCreate({
      type: 'INCOME',
      name: '__opening_income',
      amount: 20,
      date: utc(2),
      accountId: account.id,
    });

    const first = await recalculateAccountBalance(account.id);
    const second = await recalculateAccountBalance(account.id);
    expect(first!.newBalance).toBe(100);
    expect(second!.newBalance).toBe(100);
    expect(second!.difference).toBe(0);
  });
});

describe('PUT /accounts/:id — editing the Starting Balance', () => {
  /**
   * This endpoint used to strip `openingBalance` and ignore it, because writing
   * the opening on its own breaks the invariant: the transaction sum does not
   * change, so `balance` has to move by the same delta. It now accepts the field
   * and re-seeds the chain, which is what makes the edit safe.
   */
  it('shifts balance by the same delta and keeps the invariant true', async () => {
    const created = await post('/accounts', {
      name: `__put_${Date.now()}`,
      type: 'Checking',
      balance: 100,
    });
    const account = (await created.json()) as { id: string };

    await ledgerCreate({
      type: 'EXPENSE',
      name: '__put_expense',
      amount: 30,
      date: utc(12),
      accountId: account.id,
    });
    // opening 100 - 30 = 70
    const before = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(Number(before.balance)).toBe(70);

    // Move the opening down by 25; the balance must follow by exactly -25.
    const res = await put(`/accounts/${account.id}`, { name: 'Renamed', openingBalance: 75 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      name: string;
      openingBalance: number;
      balance: number;
    };
    expect(body.name).toBe('Renamed');
    expect(body.openingBalance).toBe(75);
    expect(body.balance).toBe(45); // 70 - 25, reported post-rebuild

    const row = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(Number(row.openingBalance)).toBe(75);
    expect(Number(row.balance)).toBe(45);
  });

  it('re-seeds the balance chain from the new opening', async () => {
    const created = await post('/accounts', {
      name: `__put_chain_${Date.now()}`,
      type: 'Checking',
      balance: 500,
    });
    const account = (await created.json()) as { id: string };
    const tx = await ledgerCreate({
      type: 'EXPENSE',
      name: '__put_chain_expense',
      amount: 40,
      date: utc(13),
      accountId: account.id,
    });

    await put(`/accounts/${account.id}`, { openingBalance: 300 });

    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(Number(row.balanceBefore)).toBe(300); // was 500
    expect(Number(row.balanceAfter)).toBe(260);
  });

  it('leaves the opening alone when the field is omitted', async () => {
    const created = await post('/accounts', {
      name: `__put_omit_${Date.now()}`,
      type: 'Checking',
      balance: 250,
    });
    const account = (await created.json()) as { id: string };

    const res = await put(`/accounts/${account.id}`, { name: 'Only a rename' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { openingBalance: number; balance: number };
    expect(body.openingBalance).toBe(250);
    expect(body.balance).toBe(250);
  });

  it('is a no-op when the submitted opening is unchanged', async () => {
    // The form always submits the field, so an untouched edit must not trigger
    // a rebuild — it would be wasted work on every save.
    const created = await post('/accounts', {
      name: `__put_same_${Date.now()}`,
      type: 'Checking',
      balance: 80,
    });
    const account = (await created.json()) as { id: string };
    const tx = await ledgerCreate({
      type: 'EXPENSE',
      name: '__put_same_expense',
      amount: 10,
      date: utc(14),
      accountId: account.id,
    });

    // Blank the chain; an unchanged opening must leave it blank.
    await prisma.transaction.update({
      where: { id: tx.id },
      data: { balanceBefore: null, balanceAfter: null },
    });

    await put(`/accounts/${account.id}`, { name: 'Renamed again', openingBalance: 80 });

    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(row.balanceBefore).toBeNull();
    expect(row.balanceAfter).toBeNull();
  });
});

describe('rebuildBalanceChain seeds from openingBalance', () => {
  it('starts the chain at the opening and writes back the right balance', async () => {
    // rebuildBalanceChain carried the same defect as recalculateAccountBalance:
    // both running totals started at zero, and the second one is written back to
    // Account.balance — so rebuilding a chain erased the starting balance too.
    const account = await prisma.account.create({
      data: { name: `__chain_${Date.now()}`, type: 'CHECKING', balance: 300, openingBalance: 300 },
    });
    const tx = await ledgerCreate({
      type: 'EXPENSE',
      name: '__chain_expense',
      amount: 25,
      date: utc(6),
      accountId: account.id,
    });

    const result = await rebuildBalanceChain(account.id);
    expect(result).not.toBeNull();
    expect(result!.finalBalance).toBe(275); // 300 - 25, not -25

    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(Number(row.balanceBefore)).toBe(300);
    expect(Number(row.balanceAfter)).toBe(275);
  });

  /**
   * The 2026-07-19 Prime Visa wreck, in miniature.
   *
   * `rebuildBalanceChain` used to walk twice: a source-only pass that wrote
   * every ordinary row's chain, and a merged pass that wrote the inbound
   * transfers' columns and the account total. Only the second queried
   * `toAccountId`, so the per-row chain never received a transfer INTO the
   * account while the account's own total did.
   *
   * That is exactly the shape of a credit card: spend, spend, pay the card,
   * spend. On the real card it was nine payments and tens of thousands of silent
   * drift, and it surfaced only because editing `openingBalance` triggers this
   * rebuild — replacing a chain the balance hook had kept correct since ADR-018
   * fixed the same omission in the incremental path.
   *
   * The assertion that matters is the LAST ordinary row: its `balanceBefore`
   * must have the payment in it. Checking only the account total would have
   * passed against the broken code, because the total was the half that worked.
   */
  it('credits inbound transfers to the per-row chain, not just the account total', async () => {
    const stamp = Date.now();
    const card = await prisma.account.create({
      data: { name: `__card_${stamp}`, type: 'CREDIT_CARD', balance: 0, openingBalance: 0 },
    });
    const checking = await prisma.account.create({
      data: { name: `__payer_${stamp}`, type: 'CHECKING', balance: 5000, openingBalance: 5000 },
    });

    await ledgerCreate({
      type: 'EXPENSE',
      name: '__card_spend_1',
      amount: 100,
      date: utc(1),
      accountId: card.id,
    });
    // The payment: money arriving at the card, reducing what is owed.
    await ledgerCreate({
      type: 'TRANSFER',
      name: '__card_payment',
      amount: 60,
      date: utc(2),
      accountId: checking.id,
      toAccountId: card.id,
    });
    const after = await ledgerCreate({
      type: 'EXPENSE',
      name: '__card_spend_2',
      amount: 10,
      date: utc(3),
      accountId: card.id,
    });

    const result = await rebuildBalanceChain(card.id);

    // 0 − 100 + 60 − 10
    expect(result!.finalBalance).toBe(-50);

    const last = await prisma.transaction.findUniqueOrThrow({ where: { id: after.id } });
    // −100 + 60. The old code produced −100 here: correct total, wrong rows.
    expect(Number(last.balanceBefore)).toBe(-40);
    expect(Number(last.balanceAfter)).toBe(-50);

    // The invariant the whole feature rests on still holds afterwards.
    const reread = await prisma.account.findUniqueOrThrow({ where: { id: card.id } });
    expect(Number(reread.balance)).toBe(-50);
  });

  /**
   * A transfer belongs to two chains and owns a different column pair in each.
   * Writing `balanceBefore` while rebuilding the DESTINATION would stamp the
   * recipient's figures over the sender's — which is why three of the real
   * card's payment rows displayed the checking account's running balance.
   */
  it('writes the destination columns on an inbound transfer, leaving the sender’s intact', async () => {
    const stamp = Date.now();
    const card = await prisma.account.create({
      data: { name: `__dest_${stamp}`, type: 'CREDIT_CARD', balance: 0, openingBalance: 0 },
    });
    const checking = await prisma.account.create({
      data: { name: `__src_${stamp}`, type: 'CHECKING', balance: 900, openingBalance: 900 },
    });

    const payment = await ledgerCreate({
      type: 'TRANSFER',
      name: '__two_sided',
      amount: 200,
      date: utc(4),
      accountId: checking.id,
      toAccountId: card.id,
    });

    await rebuildBalanceChain(checking.id);
    await rebuildBalanceChain(card.id);

    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: payment.id } });
    // Sender's side: 900 → 700, written when the checking chain was rebuilt.
    expect(Number(row.balanceBefore)).toBe(900);
    expect(Number(row.balanceAfter)).toBe(700);
    // Recipient's side: 0 → 200, written when the card chain was rebuilt.
    expect(Number(row.toBalanceBefore)).toBe(0);
    expect(Number(row.toBalanceAfter)).toBe(200);
  });
});

describe('bulk delete resets balance to the opening, not zero', () => {
  it('restores openingBalance after a full transaction wipe', async () => {
    // ADR-028 resets derived state to its "trivial baseline" after a total wipe.
    // With no transactions left, that baseline is the opening balance — zeroing
    // it would discard the Starting Balance and break the invariant immediately.
    const account = await prisma.account.create({
      data: { name: `__wipe_${Date.now()}`, type: 'CHECKING', balance: 750, openingBalance: 750 },
    });
    await ledgerCreate({
      type: 'EXPENSE',
      name: '__wipe_expense',
      amount: 200,
      date: utc(7),
      accountId: account.id,
    });

    const mid = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(Number(mid.balance)).toBe(550);

    const res = await req('DELETE', '/data-management/bulk?confirm=true', {
      categories: ['all-transactions'],
    });
    expect(res.status).toBe(200);

    const after = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(Number(after.balance)).toBe(750); // opening, not 0
    expect(Number(after.openingBalance)).toBe(750);
  });
});

describe('ledger invariant: openingBalance + SUM(transactions) == balance', () => {
  it('holds across a mixed set of transactions and a transfer', async () => {
    const card = await prisma.account.create({
      data: {
        name: `__inv_card_${Date.now()}`,
        type: 'CREDIT_CARD',
        balance: -200,
        openingBalance: -200,
      },
    });
    const checking = await prisma.account.create({
      data: {
        name: `__inv_chk_${Date.now()}`,
        type: 'CHECKING',
        balance: 1000,
        openingBalance: 1000,
      },
    });

    await ledgerCreate({
      type: 'EXPENSE',
      name: '__inv_expense',
      amount: 50.25,
      date: utc(3),
      accountId: card.id,
    });
    await ledgerCreate({
      type: 'REFUND',
      name: '__inv_refund',
      amount: 10.1,
      date: utc(4),
      accountId: card.id,
    });
    // Card payment: leaves checking, arrives at the card.
    await ledgerCreate({
      type: 'TRANSFER',
      name: '__inv_payment',
      amount: 100,
      date: utc(5),
      accountId: checking.id,
      toAccountId: card.id,
    });

    for (const id of [card.id, checking.id]) {
      const account = await prisma.account.findUniqueOrThrow({ where: { id } });
      const rows = await prisma.$queryRaw<{ total: string | null }[]>`
        SELECT SUM(
          CASE
            WHEN t.type IN ('INCOME','REFUND') THEN t."netAmount"
            WHEN t.type = 'EXPENSE' THEN -t."netAmount"
            WHEN t.type = 'TRANSFER' AND t."toAccountId" = ${id} THEN t."netAmount"
            WHEN t.type = 'TRANSFER' THEN -t."netAmount"
            ELSE 0 END)::text AS total
        FROM "Transaction" t
        WHERE t."parentId" IS NULL
          AND (t."accountId" = ${id} OR (t."toAccountId" = ${id} AND t.type = 'TRANSFER'))
      `;
      const sum = Number(rows[0]?.total ?? 0);
      const expected = Math.round((Number(account.openingBalance) + sum) * 100) / 100;
      expect(Number(account.balance), `invariant broken on ${account.name}`).toBe(expected);
    }
  });
});
