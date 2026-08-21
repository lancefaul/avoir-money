/**
 * Integration tests for the reconciliation API.
 *
 * Every write endpoint calls the route, asserts the response, and reads the
 * record back from the database.
 *
 * The test that matters most is `combined correction` at the bottom: it proves
 * the behaviour the entire design exists to produce — correcting a transaction
 * whose error was offset by the opening balance drives the residual non-zero and
 * blocks the close until the opening is corrected too.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@budget-tracker/db';
import { post, get, req } from '../test/helpers.js';
import { ledgerCreate } from '../lib/lifecycle/index.js';

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    await prisma.$connect();
  }
});

const PERIOD_START = '2026-06-01';
const PERIOD_END = '2026-06-30';
const utc = (d: number) => new Date(Date.UTC(2026, 5, d));

let n = 0;
async function makeAccount(balance = 0, openingBalance = balance) {
  return prisma.account.create({
    data: {
      name: `__rec_${Date.now()}_${++n}`,
      type: 'CHECKING',
      balance,
      openingBalance,
    },
  });
}

async function openSession(accountId: string, anchor: number) {
  const res = await post('/reconciliations', {
    accountId,
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    statementEndingBalance: anchor,
  });
  return { res, body: (await res.json()) as { id: string; status: string } };
}

const CSV = [
  'Transaction Date,Post Date,Description,Category,Type,Amount,Memo',
  '06/10/2026,06/11/2026,ACME BAKERY,Food,Sale,-24.50,',
  '06/12/2026,06/13/2026,"CORNER COFFEE, LLC",Food,Sale,-5.00,',
].join('\n');

describe('POST /reconciliations', () => {
  it('opens a session and persists it', async () => {
    const account = await makeAccount(100);
    const { res, body } = await openSession(account.id, 100);
    expect(res.status).toBe(201);

    const row = await prisma.reconciliationSession.findUniqueOrThrow({ where: { id: body.id } });
    expect(row.accountId).toBe(account.id);
    expect(row.status).toBe('DRAFT');
    expect(Number(row.statementEndingBalance)).toBe(100);
  });

  it('rejects a second draft for the same account', async () => {
    const account = await makeAccount(100);
    await openSession(account.id, 100);
    const { res } = await openSession(account.id, 200);
    expect(res.status).toBe(409);
  });

  it('returns 404 for an unknown account', async () => {
    const res = await post('/reconciliations', {
      accountId: 'nope',
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      statementEndingBalance: 0,
    });
    expect(res.status).toBe(404);
  });

  it('rejects a period whose end precedes its start', async () => {
    const account = await makeAccount(100);
    const res = await post('/reconciliations', {
      accountId: account.id,
      periodStart: PERIOD_END,
      periodEnd: PERIOD_START,
      statementEndingBalance: 0,
    });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /reconciliations/:id', () => {
  it('updates the anchor and moves the residual with it', async () => {
    const account = await makeAccount(500);
    const { body } = await openSession(account.id, 0);

    const res = await req('PATCH', `/reconciliations/${body.id}`, {
      statementEndingBalance: 1650.77,
    });
    expect(res.status).toBe(200);

    const row = await prisma.reconciliationSession.findUniqueOrThrow({ where: { id: body.id } });
    expect(Number(row.statementEndingBalance)).toBe(1650.77);

    // The residual is computed from the anchor, so it must reflect the change.
    const detail = await get(`/reconciliations/${body.id}`);
    const { residual } = (await detail.json()) as {
      residual: { statementEndingBalance: number; residual: number };
    };
    expect(residual.statementEndingBalance).toBe(1650.77);
    expect(residual.residual).toBe(1150.77); // 1650.77 anchor - 500 expected
  });

  it('refuses to change a closed session', async () => {
    const account = await makeAccount(500);
    const { body } = await openSession(account.id, 500);
    await post(`/reconciliations/${body.id}/close`, {});

    const res = await req('PATCH', `/reconciliations/${body.id}`, {
      statementEndingBalance: 999,
    });
    expect(res.status).toBe(409);

    const row = await prisma.reconciliationSession.findUniqueOrThrow({ where: { id: body.id } });
    expect(Number(row.statementEndingBalance)).toBe(500);
  });

  it('returns 404 for an unknown session', async () => {
    const res = await req('PATCH', '/reconciliations/nope', { statementEndingBalance: 1 });
    expect(res.status).toBe(404);
  });
});

describe('GET /reconciliations/:id', () => {
  it('returns the session with its live residual', async () => {
    const account = await makeAccount(500);
    const { body } = await openSession(account.id, 450);

    const res = await get(`/reconciliations/${body.id}`);
    expect(res.status).toBe(200);
    const detail = (await res.json()) as {
      residual: { residual: number; expectedBalance: number; isBalanced: boolean };
      statementRows: unknown[];
    };
    expect(detail.residual.expectedBalance).toBe(500);
    expect(detail.residual.residual).toBe(-50);
    expect(detail.residual.isBalanced).toBe(false);
    expect(detail.statementRows).toEqual([]);
  });

  it('returns 404 for an unknown session', async () => {
    expect((await get('/reconciliations/nope')).status).toBe(404);
  });
});

describe('POST /reconciliations/:id/import', () => {
  it('imports rows and derives periodStart from posted dates, leaving the cutoff', async () => {
    const account = await makeAccount(0);
    // Cutoff (periodEnd) = PERIOD_END = 2026-06-30.
    const { body } = await openSession(account.id, 0);

    const res = await post(`/reconciliations/${body.id}/import`, { csv: CSV });
    expect(res.status).toBe(200);
    const result = (await res.json()) as {
      imported: number;
      skippedDuplicates: number;
      periodStart: string;
      periodEnd: string;
    };
    expect(result.imported).toBe(2);
    expect(result.skippedDuplicates).toBe(0);
    // periodStart follows the earliest POSTED date (06/11), not the 06/10 tx date.
    expect(result.periodStart.slice(0, 10)).toBe('2026-06-11');
    // periodEnd stays the user's cutoff — the import does not touch it.
    expect(result.periodEnd.slice(0, 10)).toBe('2026-06-30');

    const rows = await prisma.statementRow.findMany({ where: { sessionId: body.id } });
    expect(rows).toHaveLength(2);
    // The quoted description keeps its comma rather than shifting columns.
    expect(rows.some((r) => r.description === 'CORNER COFFEE, LLC')).toBe(true);
  });

  it('skips rows whose verbatim line was already imported', async () => {
    const account = await makeAccount(0);
    const { body } = await openSession(account.id, 0);
    await post(`/reconciliations/${body.id}/import`, { csv: CSV });

    const res = await post(`/reconciliations/${body.id}/import`, { csv: CSV });
    const result = (await res.json()) as { imported: number; skippedDuplicates: number };
    expect(result.imported).toBe(0);
    expect(result.skippedDuplicates).toBe(2);
    expect(await prisma.statementRow.count({ where: { sessionId: body.id } })).toBe(2);
  });

  /**
   * Two byte-identical lines in one file are two real charges.
   *
   * The dedupe used to treat the verbatim line as a unique key, so buying the
   * same $3.29 item twice on one day stored one row. The app's second
   * transaction then had nothing to pair with, surfaced as an unexplained
   * leftover, and — because its twin HAD matched — was reported to the user as a
   * probable duplicate. A correct transaction accused of being a double entry,
   * caused three layers upstream at import.
   */
  it('keeps both of two identical lines in one file', async () => {
    const account = await makeAccount(0);
    const { body } = await openSession(account.id, 0);

    const twice = [
      'Transaction Date,Post Date,Description,Category,Type,Amount,Memo',
      '07/14/2026,07/15/2026,Etsy.com*Printelling,Shopping,Sale,-3.29,',
      '07/14/2026,07/15/2026,Etsy.com*Printelling,Shopping,Sale,-3.29,',
    ].join('\n');

    const res = await post(`/reconciliations/${body.id}/import`, { csv: twice });
    const result = (await res.json()) as { imported: number; skippedDuplicates: number };

    expect(result.imported).toBe(2);
    expect(result.skippedDuplicates).toBe(0);
    expect(await prisma.statementRow.count({ where: { sessionId: body.id } })).toBe(2);
  });

  it('still adds nothing when that same file is imported again', async () => {
    // The count check has to keep the property the unique key was there for:
    // re-importing a file is a no-op, repeat lines and all.
    const account = await makeAccount(0);
    const { body } = await openSession(account.id, 0);

    const twice = [
      'Transaction Date,Post Date,Description,Category,Type,Amount,Memo',
      '07/14/2026,07/15/2026,Etsy.com*Printelling,Shopping,Sale,-3.29,',
      '07/14/2026,07/15/2026,Etsy.com*Printelling,Shopping,Sale,-3.29,',
    ].join('\n');

    await post(`/reconciliations/${body.id}/import`, { csv: twice });
    const res = await post(`/reconciliations/${body.id}/import`, { csv: twice });
    const result = (await res.json()) as { imported: number; skippedDuplicates: number };

    expect(result.imported).toBe(0);
    expect(result.skippedDuplicates).toBe(2);
    expect(await prisma.statementRow.count({ where: { sessionId: body.id } })).toBe(2);
  });

  it('adds only the surplus when a file gains a repeat of a stored line', async () => {
    const account = await makeAccount(0);
    const { body } = await openSession(account.id, 0);
    const line = '07/14/2026,07/15/2026,Etsy.com*Printelling,Shopping,Sale,-3.29,';
    const header = 'Transaction Date,Post Date,Description,Category,Type,Amount,Memo';

    await post(`/reconciliations/${body.id}/import`, { csv: [header, line].join('\n') });
    const res = await post(`/reconciliations/${body.id}/import`, {
      csv: [header, line, line].join('\n'),
    });
    const result = (await res.json()) as { imported: number; skippedDuplicates: number };

    expect(result.imported).toBe(1);
    expect(await prisma.statementRow.count({ where: { sessionId: body.id } })).toBe(2);
  });

  it('pairs both app transactions when the bank printed the charge twice', async () => {
    // End to end: the import bug only became visible after matching, as a false
    // duplicate accusation. Both sides have two rows, so both must pair.
    const account = await makeAccount(0);
    const { body } = await openSession(account.id, 0);

    for (let i = 0; i < 2; i++) {
      await ledgerCreate({
        accountId: account.id,
        date: new Date(Date.UTC(2026, 6, 14)),
        name: 'Etsy',
        amount: 3.29,
        type: 'EXPENSE',
      });
    }

    const twice = [
      'Transaction Date,Post Date,Description,Category,Type,Amount,Memo',
      '07/14/2026,07/15/2026,Etsy.com*Printelling,Shopping,Sale,-3.29,',
      '07/14/2026,07/15/2026,Etsy.com*Printelling,Shopping,Sale,-3.29,',
    ].join('\n');
    await post(`/reconciliations/${body.id}/import`, { csv: twice });

    const res = await post(`/reconciliations/${body.id}/match`, {});
    const result = (await res.json()) as { matched: number; summary: Record<string, number> };

    expect(result.matched).toBe(2);
    expect(result.summary.duplicate_in_app ?? 0).toBe(0);
  });

  it('rejects an unparseable CSV with the line number and writes nothing', async () => {
    const account = await makeAccount(0);
    const { body } = await openSession(account.id, 0);

    const bad = [
      'Transaction Date,Post Date,Description,Category,Type,Amount,Memo',
      '06/10/2026,06/11/2026,ACME BAKERY,Food,Sale,-24.50,',
      '06/11/2026,06/12/2026,BROKEN ROW,Food,Sale,not-a-number,',
    ].join('\n');

    const res = await post(`/reconciliations/${body.id}/import`, { csv: bad });
    expect(res.status).toBe(400);
    const err = (await res.json()) as { error: string };
    expect(err.error).toMatch(/Line 3/);
    // Nothing partially imported — a half-loaded statement produces a residual
    // indistinguishable from a real discrepancy.
    expect(await prisma.statementRow.count({ where: { sessionId: body.id } })).toBe(0);
  });
});

/**
 * periodStart is the matching window's start and must cover every row the session
 * holds — it used to be taken from whichever file arrived last, leaving older rows
 * outside the window. periodEnd is the user's cutoff and is NEVER derived from the
 * file: welding it to the statement's last posted date is exactly what parked a
 * user's recent activity outside the comparison and hid the residual they needed.
 */
describe('period detection across multiple imports', () => {
  const JUNE = [
    'Transaction Date,Post Date,Description,Category,Type,Amount,Memo',
    '06/02/2026,06/03/2026,EARLY VENDOR,Food,Sale,-10.00,',
    '06/20/2026,06/21/2026,MID VENDOR,Food,Sale,-20.00,',
  ].join('\n');

  it('widens periodStart to span every imported statement, and never touches the cutoff', async () => {
    const account = await makeAccount(0);
    // openSession sets the cutoff (periodEnd) to PERIOD_END = 2026-06-30.
    const { body } = await openSession(account.id, 0);

    await post(`/reconciliations/${body.id}/import`, { csv: JUNE });
    const afterFirst = await prisma.reconciliationSession.findUniqueOrThrow({
      where: { id: body.id },
    });
    expect(afterFirst.periodStart.toISOString().slice(0, 10)).toBe('2026-06-03');
    // Cutoff untouched by the import, even though the last posted row is 06-21.
    expect(afterFirst.periodEnd.toISOString().slice(0, 10)).toBe('2026-06-30');

    // A later statement must extend periodStart's span, not replace it.
    const res = await post(`/reconciliations/${body.id}/import`, { csv: CSV });
    expect(res.status).toBe(200);
    const result = (await res.json()) as { periodStart: string; periodEnd: string };
    expect(result.periodStart.slice(0, 10)).toBe('2026-06-03');
    // Still the cutoff, not the union of the files' posted dates.
    expect(result.periodEnd.slice(0, 10)).toBe('2026-06-30');

    const row = await prisma.reconciliationSession.findUniqueOrThrow({ where: { id: body.id } });
    expect(row.periodStart.toISOString().slice(0, 10)).toBe('2026-06-03');
    expect(row.periodEnd.toISOString().slice(0, 10)).toBe('2026-06-30');
  });

  it('leaves periodStart untouched when every row is a duplicate', async () => {
    const account = await makeAccount(0);
    const { body } = await openSession(account.id, 0);
    await post(`/reconciliations/${body.id}/import`, { csv: JUNE });
    const before = await prisma.reconciliationSession.findUniqueOrThrow({ where: { id: body.id } });

    const res = await post(`/reconciliations/${body.id}/import`, { csv: JUNE });
    const result = (await res.json()) as { imported: number; skippedDuplicates: number };
    expect(result.imported).toBe(0);
    expect(result.skippedDuplicates).toBe(2);

    const after = await prisma.reconciliationSession.findUniqueOrThrow({ where: { id: body.id } });
    expect(after.periodStart.getTime()).toBe(before.periodStart.getTime());
    expect(after.periodEnd.getTime()).toBe(before.periodEnd.getTime());
  });
});

/**
 * The cutoff is the whole point of the feature: it decides which activity is
 * inside the balance comparison. This is the reduced form of the real bug — a
 * charge dated after the statement's last posted line was excluded from the
 * residual and the tool reported an inflated, unexplained difference.
 */
describe('the cutoff (periodEnd) drives the residual', () => {
  it('excludes activity after the cutoff, and PATCHing the cutoff includes it', async () => {
    const account = await makeAccount(1000, 1000);
    // Cutoff = 2026-06-30. Anchor 900.
    const { body } = await openSession(account.id, 900);

    // A charge dated AFTER the cutoff — the "pending, not on the statement yet"
    // case that was landing in the difference.
    await ledgerCreate({
      name: 'Late charge',
      type: 'EXPENSE',
      amount: 40,
      date: new Date(Date.UTC(2026, 6, 15)), // 2026-07-15, after the 06-30 cutoff
      accountId: account.id,
    });

    // As of 06-30 the account still reads 1000; residual = 900 − 1000 = −100,
    // and the 40 sits in activityAfterPeriodEnd, NOT in the difference.
    const before = (await (await get(`/reconciliations/${body.id}`)).json()) as {
      residual: { residual: number; activityAfterPeriodEnd: number; expectedBalance: number };
    };
    expect(before.residual.expectedBalance).toBe(1000);
    expect(before.residual.residual).toBe(-100);
    expect(before.residual.activityAfterPeriodEnd).toBe(-40);

    // Move the cutoff past the charge. Now it is inside the comparison: expected
    // drops to 960, the residual absorbs the 40, and activity-after clears.
    const patch = await req('PATCH', `/reconciliations/${body.id}`, { periodEnd: '2026-07-31' });
    expect(patch.status).toBe(200);

    const after = (await (await get(`/reconciliations/${body.id}`)).json()) as {
      residual: { residual: number; activityAfterPeriodEnd: number; expectedBalance: number };
    };
    expect(after.residual.expectedBalance).toBe(960);
    expect(after.residual.residual).toBe(-60);
    expect(after.residual.activityAfterPeriodEnd).toBe(0);
  });

  it('rejects a PATCH that carries neither field', async () => {
    const account = await makeAccount(0);
    const { body } = await openSession(account.id, 0);
    expect((await req('PATCH', `/reconciliations/${body.id}`, {})).status).toBe(400);
  });
});

describe('POST /reconciliations/:id/match', () => {
  it('matches statement rows against transactions and persists the pairings', async () => {
    const account = await makeAccount(0);
    await ledgerCreate({
      type: 'EXPENSE',
      name: 'Acme Bakery',
      amount: 24.5,
      date: utc(10),
      accountId: account.id,
    });
    const { body } = await openSession(account.id, 0);
    await post(`/reconciliations/${body.id}/import`, { csv: CSV });

    const res = await post(`/reconciliations/${body.id}/match`, {});
    expect(res.status).toBe(200);
    const result = (await res.json()) as { matched: number; summary: Record<string, number> };
    expect(result.matched).toBeGreaterThanOrEqual(1);

    const matches = await prisma.reconciliationMatch.findMany({ where: { sessionId: body.id } });
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('matches a Cash Wallet trade SELL as a credit, not a sign-flip', async () => {
    // On Cash Wallet the broker IS the account: a Bitcoin/stock SELL deposits
    // dollars straight into the cash balance. Before the direction fix the app
    // row was signed as a charge, so it paired with its statement credit as a
    // false sign-flip and drove a phantom into the remainder. This exercises the
    // whole path — the loader must select tradeDetail.direction for it to work.
    const account = await makeAccount(0);
    const custodian = await prisma.custodian.create({ data: { name: `__rec_cust_${++n}` } });
    const sell = await ledgerCreate({
      type: 'TRADE',
      name: 'Sell TCKC',
      amount: 450,
      date: utc(15),
      accountId: account.id,
      tradeMetadata: {
        direction: 'SELL',
        assetType: 'Stock',
        ticker: 'TCKC',
        unitPrice: 100,
        quantity: 4.5,
        custodianId: custodian.id,
      },
    });

    // Cash Wallet export: a USD sell prints as a positive Net Amount (money in).
    const cashApp = [
      '"Date","Transaction ID","Transaction Type","Currency","Amount","Fee","Net Amount","Asset Type","Asset Price","Asset Amount","Status","Notes","Name of sender/receiver","Account"',
      '"2026-06-15 10:00:00 CDT","","Stock Sell","USD","$450.00","$0.00","$450.00","Stock","$100.00","4.5","COMPLETE","Sell TCKC","","Cash Balance"',
    ].join('\n');

    const { body } = await openSession(account.id, 450);
    await post(`/reconciliations/${body.id}/import`, { csv: cashApp });
    const res = await post(`/reconciliations/${body.id}/match`, {});
    const result = (await res.json()) as { summary: Record<string, number> };

    // The discriminator: a sell must not read as a direction disagreement, and
    // its statement line must not be left unmatched.
    expect(result.summary.sign_flip ?? 0).toBe(0);
    expect(result.summary.missing_in_app ?? 0).toBe(0);

    // And the pairing points at the trade itself.
    const matches = await prisma.reconciliationMatch.findMany({ where: { sessionId: body.id } });
    expect(matches.map((m) => m.transactionId)).toContain(sell.id);
  });

  it('pairs a trade whose computed amount drifts a couple of cents from the settled one', async () => {
    // A trade's app amount is `unitPrice × quantity` rounded; the broker settles
    // at the actual fill, so the two disagree by cents on an otherwise perfect
    // match. The name gate that guards every other approximate pairing is
    // unreachable here — a brokerage descriptor names the whole legal instrument
    // and shares almost nothing with "Buy ZNTH" — so before the relaxation this
    // reported as one phantom plus one missing row for every trade.
    //
    // This is the wiring test: the matcher's rule is proven in core, but nothing
    // there can see that the route sets `isTrade` from the transaction type.
    const account = await makeAccount(0);
    const custodian = await prisma.custodian.create({ data: { name: `__rec_cust_${++n}` } });
    const buy = await ledgerCreate({
      type: 'TRADE',
      name: 'Buy ZNTH',
      amount: 120.02,
      date: utc(9),
      accountId: account.id,
      tradeMetadata: {
        direction: 'BUY',
        assetType: 'Stock',
        ticker: 'ZNTH',
        unitPrice: 28.576,
        quantity: 4.2,
        custodianId: custodian.id,
      },
    });

    // Cash Wallet prints the settled figure and describes the instrument in full.
    const cashApp = [
      '"Date","Transaction ID","Transaction Type","Currency","Amount","Fee","Net Amount","Asset Type","Asset Price","Asset Amount","Status","Notes","Name of sender/receiver","Account"',
      '"2026-06-09 10:00:00 CDT","","Stock Buy","USD","-$120.00","$0.00","-$120.00","Stock","$28.58","4.2","COMPLETE","$120.00 Purchase of Zenith Variable Rate Perpetual Stretch Preferred Stock","","Cash Balance"',
    ].join('\n');

    const { body } = await openSession(account.id, -120.0);
    await post(`/reconciliations/${body.id}/import`, { csv: cashApp });
    const res = await post(`/reconciliations/${body.id}/match`, {});
    const result = (await res.json()) as { summary: Record<string, number> };

    // Neither side is orphaned...
    expect(result.summary.missing_in_app ?? 0).toBe(0);
    expect(result.summary.missing_in_bank_phantom ?? 0).toBe(0);
    // ...and the 2¢ is reported rather than absorbed.
    expect(result.summary.amount_mismatch ?? 0).toBe(1);

    const matches = await prisma.reconciliationMatch.findMany({ where: { sessionId: body.id } });
    expect(matches.map((m) => m.transactionId)).toContain(buy.id);
  });

  it('excludes fully-offset transactions the bank never printed', async () => {
    // A purchase entirely covered by rewards moves no cash on the account, so the
    // bank statement never shows it — it must be excluded from reconciliation.
    const account = await prisma.account.create({
      data: {
        name: `__rec_${Date.now()}_${++n}`,
        type: 'CHECKING',
        balance: 0,
        openingBalance: 0,
        hasRewards: true,
      },
    });
    // A row the bank never printed: charged figure (netAmount) is 0 though the
    // sticker was 24.50. Built directly since the rewardsApplied input that
    // produced a fully-offset row is retired.
    await prisma.transaction.create({
      data: {
        type: 'EXPENSE',
        name: 'Acme Bakery',
        amount: 24.5,
        netAmount: 0,
        date: utc(10),
        accountId: account.id,
      },
    });

    const { body } = await openSession(account.id, 0);
    await post(`/reconciliations/${body.id}/import`, { csv: CSV });
    const res = await post(`/reconciliations/${body.id}/match`, {});
    const result = (await res.json()) as { summary: Record<string, number> };

    // The offset row must not be reported as a phantom.
    expect(result.summary.missing_in_bank_phantom ?? 0).toBe(0);
  });
});

/**
 * Same merchant, same day, several charges — completely ordinary, and the exact
 * shape that broke. Findings used to be mapped back to rows by
 * (date, description), which is not unique: all five collapsed to one row id, so
 * one row collected five matches and the other four were reported as missing
 * from the app. Every row must receive its own pairing.
 */
/**
 * Rewards and gift cards are settled before the charge reaches the card, so the
 * statement prints the NET. Matching on the gross reported a clean transaction
 * as an amount mismatch — and it also disagreed with the residual, which has
 * always summed netAmount.
 */
describe('rewards and gift cards', () => {
  const WHOLE_FOODS = [
    'Transaction Date,Post Date,Description,Category,Type,Amount,Memo',
    '06/03/2026,06/04/2026,Whole Foods AMB 10528,Groceries,Sale,-140.00,',
  ].join('\n');

  it('matches on the net charge, not the gross basket', async () => {
    const account = await makeAccount(0);
    // $200.00 sticker, charged $140.00 (a historical rewards-discounted row,
    // built directly since the rewardsApplied input is retired).
    await prisma.transaction.create({
      data: {
        type: 'EXPENSE',
        name: 'Whole Foods',
        amount: 200.0,
        netAmount: 140.0,
        date: utc(3),
        accountId: account.id,
      },
    });

    const { body } = await openSession(account.id, 0);
    await post(`/reconciliations/${body.id}/import`, { csv: WHOLE_FOODS });
    const res = await post(`/reconciliations/${body.id}/match`, {});
    const result = (await res.json()) as { summary: Record<string, number> };

    // A clean pairing, not an amount mismatch.
    expect(result.summary.amount_mismatch ?? 0).toBe(0);
    expect(result.summary.missing_in_app ?? 0).toBe(0);
    expect(await prisma.reconciliationMatch.count({ where: { sessionId: body.id } })).toBe(1);
  });

  it('reports the net amount and the offset to the client', async () => {
    const account = await makeAccount(0);
    // Sticker $200.00, charged $140.00 → an offset of $60.00 (built directly).
    await prisma.transaction.create({
      data: {
        type: 'EXPENSE',
        name: 'Whole Foods',
        amount: 200.0,
        netAmount: 140.0,
        date: utc(3),
        accountId: account.id,
      },
    });
    const { body } = await openSession(account.id, 0);

    const detail = await get(`/reconciliations/${body.id}`);
    const { appTransactions } = (await detail.json()) as {
      appTransactions: { amount: number; offset: number }[];
    };
    const tx = appTransactions.find((t) => Math.abs(t.amount - 140.0) < 0.005);
    expect(tx).toBeDefined();
    expect(tx!.offset).toBeCloseTo(60.0, 2);
  });
});

describe('repeated merchant lines on one day', () => {
  const REPEATED = [
    'Transaction Date,Post Date,Description,Category,Type,Amount,Memo',
    '06/06/2026,06/07/2026,WM SUPERCENTER #2938,Groceries,Sale,-1.18,',
    '06/06/2026,06/07/2026,WM SUPERCENTER #2938,Groceries,Sale,-3.27,',
    '06/06/2026,06/07/2026,WM SUPERCENTER #2938,Groceries,Sale,-10.86,',
    '06/06/2026,06/07/2026,WM SUPERCENTER #2938,Groceries,Sale,-19.20,',
    '06/06/2026,06/07/2026,WM SUPERCENTER #2938,Groceries,Sale,-37.04,',
  ].join('\n');

  it('gives every repeated line its own match', async () => {
    const account = await makeAccount(0);
    for (const amount of [1.18, 3.27, 10.86, 19.2, 37.04]) {
      await ledgerCreate({
        type: 'EXPENSE',
        name: 'Walmart',
        amount,
        date: utc(6),
        accountId: account.id,
      });
    }

    const { body } = await openSession(account.id, 0);
    await post(`/reconciliations/${body.id}/import`, { csv: REPEATED });
    await post(`/reconciliations/${body.id}/match`, {});

    const rows = await prisma.statementRow.findMany({
      where: { sessionId: body.id },
      include: { matches: true },
    });
    expect(rows).toHaveLength(5);

    // Every row matched, exactly once — no row hoarding the others' pairings.
    for (const row of rows) {
      expect(row.matches).toHaveLength(1);
    }

    // And each is paired with the transaction of the same amount.
    const txs = await prisma.transaction.findMany({ where: { accountId: account.id } });
    const byId = new Map(txs.map((t) => [t.id, Number(t.amount)]));
    for (const row of rows) {
      expect(byId.get(row.matches[0]!.transactionId)).toBe(Math.abs(Number(row.amount)));
    }

    const matchCount = await prisma.reconciliationMatch.count({ where: { sessionId: body.id } });
    expect(matchCount).toBe(5);
  });
});

describe('manual matches', () => {
  it('creates and removes a hand-made pairing', async () => {
    const account = await makeAccount(0);
    const tx = await ledgerCreate({
      type: 'EXPENSE',
      name: 'Something Else',
      amount: 24.5,
      date: utc(10),
      accountId: account.id,
    });
    const { body } = await openSession(account.id, 0);
    await post(`/reconciliations/${body.id}/import`, { csv: CSV });
    const row = await prisma.statementRow.findFirstOrThrow({ where: { sessionId: body.id } });

    const created = await post(`/reconciliations/${body.id}/matches`, {
      statementRowId: row.id,
      transactionId: tx.id,
    });
    expect(created.status).toBe(201);
    const match = (await created.json()) as { id: string; matchType: string };
    expect(match.matchType).toBe('MANUAL');
    expect(await prisma.reconciliationMatch.findUnique({ where: { id: match.id } })).not.toBeNull();

    const removed = await req('DELETE', `/reconciliations/${body.id}/matches/${match.id}`);
    expect(removed.status).toBe(200);
    expect(await prisma.reconciliationMatch.findUnique({ where: { id: match.id } })).toBeNull();
  });

  it('rejects a duplicate pairing', async () => {
    const account = await makeAccount(0);
    const tx = await ledgerCreate({
      type: 'EXPENSE',
      name: 'Something Else',
      amount: 24.5,
      date: utc(10),
      accountId: account.id,
    });
    const { body } = await openSession(account.id, 0);
    await post(`/reconciliations/${body.id}/import`, { csv: CSV });
    const row = await prisma.statementRow.findFirstOrThrow({ where: { sessionId: body.id } });

    await post(`/reconciliations/${body.id}/matches`, {
      statementRowId: row.id,
      transactionId: tx.id,
    });
    const second = await post(`/reconciliations/${body.id}/matches`, {
      statementRowId: row.id,
      transactionId: tx.id,
    });
    expect(second.status).toBe(409);
  });

  /**
   * The UI re-runs matching after every resolution, so this path is walked
   * constantly. If it wiped hand-made pairings, a user's manual work would
   * vanish the moment they fixed anything else — silently, and with no undo.
   */
  it('survives a re-run of the automatic matcher', async () => {
    const account = await makeAccount(0);
    // Deliberately named nothing like the statement and dated apart, so the
    // automatic pass could never reproduce this pairing on its own.
    const tx = await ledgerCreate({
      type: 'EXPENSE',
      name: 'Nothing Like The Statement',
      amount: 24.5,
      date: utc(10),
      accountId: account.id,
    });
    const { body } = await openSession(account.id, 0);
    await post(`/reconciliations/${body.id}/import`, { csv: CSV });
    const row = await prisma.statementRow.findFirstOrThrow({
      where: { sessionId: body.id, description: 'ACME BAKERY' },
    });

    const created = await post(`/reconciliations/${body.id}/matches`, {
      statementRowId: row.id,
      transactionId: tx.id,
    });
    const match = (await created.json()) as { id: string };

    await post(`/reconciliations/${body.id}/match`, {});

    const after = await prisma.reconciliationMatch.findUnique({ where: { id: match.id } });
    expect(after).not.toBeNull();
    expect(after?.matchType).toBe('MANUAL');
  });

  it('does not let the automatic pass double-pair a manually matched row', async () => {
    const account = await makeAccount(0);
    // This one WOULD be matched automatically: same amount, same date, same name.
    const auto = await ledgerCreate({
      type: 'EXPENSE',
      name: 'ACME BAKERY',
      amount: 24.5,
      date: utc(10),
      accountId: account.id,
    });
    const manual = await ledgerCreate({
      type: 'EXPENSE',
      name: 'Chosen By Hand',
      amount: 24.5,
      date: utc(10),
      accountId: account.id,
    });
    const { body } = await openSession(account.id, 0);
    await post(`/reconciliations/${body.id}/import`, { csv: CSV });
    const row = await prisma.statementRow.findFirstOrThrow({
      where: { sessionId: body.id, description: 'ACME BAKERY' },
    });

    await post(`/reconciliations/${body.id}/matches`, {
      statementRowId: row.id,
      transactionId: manual.id,
    });
    await post(`/reconciliations/${body.id}/match`, {});

    const rowMatches = await prisma.reconciliationMatch.findMany({
      where: { sessionId: body.id, statementRowId: row.id },
    });
    expect(rowMatches).toHaveLength(1);
    expect(rowMatches[0]?.transactionId).toBe(manual.id);
    expect(rowMatches.some((m) => m.transactionId === auto.id)).toBe(false);
  });
});

describe('resolutions that touch matched transactions', () => {
  it('removes the match when a matched transaction is deleted, keeping the session', async () => {
    // Deleting a phantom is a legitimate resolution, so the match row must go
    // with it — otherwise the session holds a dangling reference and the close
    // would try to stamp reconciledAt on a row that no longer exists.
    const account = await makeAccount(0);
    const tx = await ledgerCreate({
      type: 'EXPENSE',
      name: 'Acme Bakery',
      amount: 24.5,
      date: utc(10),
      accountId: account.id,
    });
    const { body } = await openSession(account.id, 0);
    await post(`/reconciliations/${body.id}/import`, { csv: CSV });
    const row = await prisma.statementRow.findFirstOrThrow({ where: { sessionId: body.id } });
    const created = await post(`/reconciliations/${body.id}/matches`, {
      statementRowId: row.id,
      transactionId: tx.id,
    });
    const match = (await created.json()) as { id: string };

    const deleted = await req('DELETE', `/transactions/${tx.id}`);
    expect(deleted.status).toBe(204);

    expect(await prisma.reconciliationMatch.findUnique({ where: { id: match.id } })).toBeNull();
    // The session and its imported rows survive the resolution.
    const session = await prisma.reconciliationSession.findUnique({ where: { id: body.id } });
    expect(session).not.toBeNull();
    expect(session!.status).toBe('DRAFT');
    expect(await prisma.statementRow.count({ where: { sessionId: body.id } })).toBe(2);
  });

  it('deletes rows and matches with the session, never the transactions', async () => {
    const account = await makeAccount(0);
    const tx = await ledgerCreate({
      type: 'EXPENSE',
      name: 'Acme Bakery',
      amount: 24.5,
      date: utc(10),
      accountId: account.id,
    });
    const { body } = await openSession(account.id, 0);
    await post(`/reconciliations/${body.id}/import`, { csv: CSV });
    await post(`/reconciliations/${body.id}/match`, {});

    await prisma.reconciliationSession.delete({ where: { id: body.id } });

    expect(await prisma.statementRow.count({ where: { sessionId: body.id } })).toBe(0);
    expect(await prisma.reconciliationMatch.count({ where: { sessionId: body.id } })).toBe(0);
    // The ledger outlives any reconciliation.
    expect(await prisma.transaction.findUnique({ where: { id: tx.id } })).not.toBeNull();
  });
});

describe('POST /reconciliations/:id/close', () => {
  it('closes when the residual is zero and clears matched transactions', async () => {
    const account = await makeAccount(1000);
    await ledgerCreate({
      type: 'EXPENSE',
      name: 'Acme Bakery',
      amount: 24.5,
      date: utc(10),
      accountId: account.id,
    });
    // opening 1000 − 24.50 = 975.50
    const { body } = await openSession(account.id, 975.5);
    await post(`/reconciliations/${body.id}/import`, { csv: CSV });
    await post(`/reconciliations/${body.id}/match`, {});

    const res = await post(`/reconciliations/${body.id}/close`, {});
    expect(res.status).toBe(200);
    const result = (await res.json()) as { clearedTransactions: number };
    expect(result.clearedTransactions).toBeGreaterThanOrEqual(1);

    const row = await prisma.reconciliationSession.findUniqueOrThrow({ where: { id: body.id } });
    expect(row.status).toBe('RECONCILED');
    expect(row.reconciledAt).not.toBeNull();
    expect(Number(row.residualAtClose)).toBe(0);

    const cleared = await prisma.transaction.findMany({
      where: { accountId: account.id, reconciledAt: { not: null } },
    });
    expect(cleared.length).toBeGreaterThanOrEqual(1);
  });

  it('refuses to close with a non-zero residual and leaves the session DRAFT', async () => {
    const account = await makeAccount(1000);
    const { body } = await openSession(account.id, 900); // 100 unaccounted for

    const res = await post(`/reconciliations/${body.id}/close`, {});
    expect(res.status).toBe(409);
    const err = (await res.json()) as { error: string };
    expect(err.error).toMatch(/unaccounted for/);

    const row = await prisma.reconciliationSession.findUniqueOrThrow({ where: { id: body.id } });
    expect(row.status).toBe('DRAFT');
    expect(row.reconciledAt).toBeNull();
  });

  it('refuses to close a session twice', async () => {
    const account = await makeAccount(100);
    const { body } = await openSession(account.id, 100);
    expect((await post(`/reconciliations/${body.id}/close`, {})).status).toBe(200);
    expect((await post(`/reconciliations/${body.id}/close`, {})).status).toBe(409);
  });
});

describe('POST /reconciliations/:id/adjustment', () => {
  it('creates a visible ledger transaction that zeroes the residual', async () => {
    const account = await makeAccount(1000);
    const { body } = await openSession(account.id, 940); // 60 short

    const res = await post(`/reconciliations/${body.id}/adjustment`, {
      reason: 'Bank fee I cannot identify',
    });
    expect(res.status).toBe(201);
    const result = (await res.json()) as { residual: { residual: number; isBalanced: boolean } };
    expect(result.residual.isBalanced).toBe(true);

    const row = await prisma.reconciliationSession.findUniqueOrThrow({ where: { id: body.id } });
    expect(row.adjustmentTransactionId).not.toBeNull();
    expect(row.adjustmentReason).toBe('Bank fee I cannot identify');

    // The adjustment is a real transaction in the register, carrying its reason.
    const adjustment = await prisma.transaction.findUniqueOrThrow({
      where: { id: row.adjustmentTransactionId! },
    });
    expect(Number(adjustment.amount)).toBe(60);
    expect(adjustment.type).toBe('EXPENSE');
    expect(adjustment.note).toBe('Bank fee I cannot identify');

    // And it must NOT have touched the opening balance.
    const acct = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(Number(acct.openingBalance)).toBe(1000);
  });

  /**
   * Requirement 6.7. The flag is derived from the session relation rather than
   * stored on the transaction, so this asserts the join actually reaches the
   * list endpoint — a badge that never renders is the same as no badge.
   */
  it('marks the adjustment as such in the transactions list', async () => {
    const account = await makeAccount(1000);
    const { body } = await openSession(account.id, 940);
    await post(`/reconciliations/${body.id}/adjustment`, { reason: 'Unidentified fee' });

    const listed = await get(`/transactions?accountId=${account.id}`);
    const { transactions } = (await listed.json()) as {
      transactions: { id: string; name: string; isReconciliationAdjustment?: boolean }[];
    };

    const adjustment = transactions.find((t) => t.name.startsWith('Reconciliation adjustment'));
    expect(adjustment?.isReconciliationAdjustment).toBe(true);

    // An ordinary transaction in the same account must not be marked.
    const ordinary = await ledgerCreate({
      type: 'EXPENSE',
      name: 'Ordinary',
      amount: 10,
      date: utc(5),
      accountId: account.id,
    });
    const again = await get(`/transactions?accountId=${account.id}`);
    const { transactions: refreshed } = (await again.json()) as {
      transactions: { id: string; isReconciliationAdjustment?: boolean }[];
    };
    expect(refreshed.find((t) => t.id === ordinary.id)?.isReconciliationAdjustment).toBe(false);
  });

  it('credits the account when the bank holds more than the app expects', async () => {
    const account = await makeAccount(1000);
    const { body } = await openSession(account.id, 1075);

    await post(`/reconciliations/${body.id}/adjustment`, { reason: 'Unexplained credit' });
    const row = await prisma.reconciliationSession.findUniqueOrThrow({ where: { id: body.id } });
    const adjustment = await prisma.transaction.findUniqueOrThrow({
      where: { id: row.adjustmentTransactionId! },
    });
    expect(adjustment.type).toBe('INCOME');
    expect(Number(adjustment.amount)).toBe(75);
  });

  it('requires a non-empty reason', async () => {
    const account = await makeAccount(1000);
    const { body } = await openSession(account.id, 940);
    expect((await post(`/reconciliations/${body.id}/adjustment`, { reason: '   ' })).status).toBe(
      400,
    );
    expect(await prisma.transaction.count({ where: { accountId: account.id } })).toBe(0);
  });

  it('refuses an adjustment when the residual is already zero', async () => {
    const account = await makeAccount(1000);
    const { body } = await openSession(account.id, 1000);
    const res = await post(`/reconciliations/${body.id}/adjustment`, { reason: 'unnecessary' });
    expect(res.status).toBe(400);
    expect(await prisma.transaction.count({ where: { accountId: account.id } })).toBe(0);
  });

  it('allows the close once an adjustment has been recorded', async () => {
    const account = await makeAccount(1000);
    const { body } = await openSession(account.id, 940);
    await post(`/reconciliations/${body.id}/adjustment`, { reason: 'Unidentified fee' });

    const res = await post(`/reconciliations/${body.id}/close`, {});
    expect(res.status).toBe(200);
    const row = await prisma.reconciliationSession.findUniqueOrThrow({ where: { id: body.id } });
    expect(row.status).toBe('RECONCILED');
  });
});

describe('POST /reconciliations/:id/abandon', () => {
  it('deletes the session without applying anything', async () => {
    const account = await makeAccount(1000);
    const { body } = await openSession(account.id, 900);

    const res = await post(`/reconciliations/${body.id}/abandon`, {});
    expect(res.status).toBe(200);

    expect(await prisma.reconciliationSession.findUnique({ where: { id: body.id } })).toBeNull();
    expect(await prisma.transaction.count({ where: { accountId: account.id } })).toBe(0);
    const acct = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(Number(acct.balance)).toBe(1000);
    expect(Number(acct.openingBalance)).toBe(1000);
  });

  it('takes the imported statement rows with it', async () => {
    const account = await makeAccount(1000);
    const { body } = await openSession(account.id, 900);
    await post(`/reconciliations/${body.id}/import`, { csv: CSV });
    expect(await prisma.statementRow.count({ where: { sessionId: body.id } })).toBe(2);

    await post(`/reconciliations/${body.id}/abandon`, {});

    // The whole reason for deleting rather than flagging: 28 abandoned sessions
    // had accumulated 25,848 orphaned statement rows that nothing ever read.
    expect(await prisma.statementRow.count({ where: { sessionId: body.id } })).toBe(0);
  });

  /**
   * The property that must never regress.
   *
   * Abandoning removes scaffolding, never ledger data. A match holds a
   * transaction, not the reverse, so the cascade stops at the match — but the
   * relation is Cascade in both directions of reading and one mis-set onDelete
   * would silently turn "cancel this reconciliation" into "delete the
   * transactions I already fixed." Nothing else in the suite would catch it.
   */
  it('leaves matched transactions and their balances untouched', async () => {
    const account = await makeAccount(1000);
    const { body } = await openSession(account.id, 900);
    await post(`/reconciliations/${body.id}/import`, { csv: CSV });

    const tx = await ledgerCreate({
      name: 'ACME BAKERY',
      type: 'EXPENSE',
      amount: 24.5,
      date: utc(10),
      accountId: account.id,
    });
    const row = await prisma.statementRow.findFirstOrThrow({ where: { sessionId: body.id } });
    await prisma.reconciliationMatch.create({
      data: {
        sessionId: body.id,
        statementRowId: row.id,
        transactionId: tx.id,
        matchType: 'MANUAL',
      },
    });

    const balanceBefore = Number(
      (await prisma.account.findUniqueOrThrow({ where: { id: account.id } })).balance,
    );

    await post(`/reconciliations/${body.id}/abandon`, {});

    const survivor = await prisma.transaction.findUnique({ where: { id: tx.id } });
    expect(survivor).not.toBeNull();
    expect(Number(survivor?.amount)).toBe(24.5);
    // The pairing is scaffolding and goes; the transaction it pointed at stays.
    expect(await prisma.reconciliationMatch.count({ where: { sessionId: body.id } })).toBe(0);
    const acct = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(Number(acct.balance)).toBe(balanceBefore);
  });

  it('frees the account to open a new session immediately', async () => {
    const account = await makeAccount(100);
    const { body } = await openSession(account.id, 100);
    await post(`/reconciliations/${body.id}/abandon`, {});

    // one_draft_per_account is a partial unique index on DRAFT rows. Deleting the
    // row clears it as surely as flagging it did, and the file-swap path in the
    // modal abandons then immediately reopens.
    const { res } = await openSession(account.id, 200);
    expect(res.status).toBe(201);
  });

  it('refuses to abandon a reconciled session', async () => {
    const account = await makeAccount(100);
    const { body } = await openSession(account.id, 100);
    await post(`/reconciliations/${body.id}/close`, {});
    expect((await post(`/reconciliations/${body.id}/abandon`, {})).status).toBe(409);

    // Refused, so it must still be there — a closed session's rows are the
    // evidence of what was reconciled against, and are not rebuildable.
    const row = await prisma.reconciliationSession.findUniqueOrThrow({ where: { id: body.id } });
    expect(row.status).toBe('RECONCILED');
  });

  it('returns 404 for an unknown session', async () => {
    expect((await post('/reconciliations/nope/abandon', {})).status).toBe(404);
  });
});

/**
 * The behaviour the whole design exists for.
 *
 * An account whose balance looks correct but whose history contains an error the
 * opening balance is silently compensating for. Correcting the transaction alone
 * must NOT be closeable — the residual becomes non-zero and exposes the second,
 * hidden error.
 */
describe('combined correction: a transaction fix forces the opening fix', () => {
  it('blocks the close until both errors are corrected', async () => {
    // True state: opening 1000, a 200 expense, so the account really holds 800.
    // Recorded state: opening 800 (too low by 200) and the expense entered as
    // 0.01 (understated by ~200) — two errors that very nearly cancel.
    //
    // The account must start INTERNALLY CONSISTENT (opening + Σtx == balance),
    // otherwise the close is refused by the ledger-invariant guard and this test
    // passes without ever exercising the residual rule. It did exactly that in
    // its first version.
    const account = await makeAccount(800, 800);
    const tx = await ledgerCreate({
      type: 'EXPENSE',
      name: 'Understated expense',
      amount: 0.01,
      date: utc(10),
      accountId: account.id,
    });
    // 800 − 0.01 = 799.99, consistent with the opening.
    const seeded = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(Number(seeded.balance)).toBe(799.99);

    // The bank says the account ended the period at 800.
    const { body } = await openSession(account.id, 800);

    // Step 1: as recorded, the app expects 800 − 0.01 = 799.99, so it is already
    // off by a cent. Correct the transaction to its true 200.
    await req('PUT', `/transactions/${tx.id}`, {
      type: 'EXPENSE',
      name: 'Understated expense',
      amount: 200,
      date: utc(10).toISOString(),
      accountId: account.id,
    });

    // Step 2: the account is still internally consistent (800 − 200 = 600), so
    // the invariant guard has nothing to say. The close is refused purely
    // because the bank says 800 and the app now says 600.
    const corrected = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(Number(corrected.balance)).toBe(600);
    expect(Number(corrected.openingBalance)).toBe(800);

    const blocked = await post(`/reconciliations/${body.id}/close`, {});
    expect(blocked.status).toBe(409);
    const blockedErr = (await blocked.json()) as { error: string };
    expect(blockedErr.error).toMatch(/unaccounted for/);

    const midway = await get(`/reconciliations/${body.id}`);
    const midResidual = ((await midway.json()) as { residual: { residual: number } }).residual;
    expect(midResidual.residual).toBeCloseTo(200, 2); // 800 − 600

    const stillDraft = await prisma.reconciliationSession.findUniqueOrThrow({
      where: { id: body.id },
    });
    expect(stillDraft.status).toBe('DRAFT');

    // Step 3: correct the opening that had been absorbing the error.
    await req('PUT', `/accounts/${account.id}`, { openingBalance: 1000 });

    // Step 4: now — and only now — the period closes.
    const closed = await post(`/reconciliations/${body.id}/close`, {});
    expect(closed.status).toBe(200);

    const finalAcct = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(Number(finalAcct.openingBalance)).toBe(1000);
    expect(Number(finalAcct.balance)).toBe(800); // matches the bank
  });
});

/**
 * The period must cover every row the session holds.
 *
 * It decides which app transactions the matcher can see, so a window narrower
 * than the rows starves it — a real session held five months of statement lines
 * under a two-week period, loaded a fortnight of transactions, and reported
 * every older line as missing from the app. Import widens the period, but a
 * session imported before that rule existed keeps its stale window forever, so
 * matching recomputes it.
 */
describe('a stale period heals on match', () => {
  const FEB = [
    'Transaction Date,Post Date,Description,Category,Type,Amount,Memo',
    '02/10/2026,02/11/2026,OLD VENDOR,Food,Sale,-40.00,',
    '07/10/2026,07/11/2026,NEW VENDOR,Food,Sale,-20.00,',
  ].join('\n');

  it('widens a window narrower than the rows, and matches what it uncovers', async () => {
    const account = await makeAccount(0);
    const { body } = await openSession(account.id, 0);
    await post(`/reconciliations/${body.id}/import`, { csv: FEB });

    // Force the stale state a pre-fix session would be left in.
    await prisma.reconciliationSession.update({
      where: { id: body.id },
      data: { periodStart: new Date('2026-07-01'), periodEnd: new Date('2026-07-11') },
    });

    // A transaction only reachable once the window covers February.
    await ledgerCreate({
      accountId: account.id,
      date: new Date(Date.UTC(2026, 1, 10)),
      name: 'Old Vendor',
      amount: 40,
      type: 'EXPENSE',
    });

    const res = await post(`/reconciliations/${body.id}/match`, {});
    const result = (await res.json()) as { matched: number };

    const healed = await prisma.reconciliationSession.findUnique({ where: { id: body.id } });
    expect(healed!.periodStart.toISOString().slice(0, 10)).toBe('2026-02-11');
    // The February line pairs, which it could not do under the stale window.
    expect(result.matched).toBeGreaterThan(0);
  });
});
