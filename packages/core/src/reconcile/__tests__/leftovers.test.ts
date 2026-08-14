/**
 * Leftover classification — the rules the matcher and the reconcile UI must
 * agree on.
 *
 * Both bugs these tests pin came from the UI deriving its own answer: unposted
 * charges listed beside months-old discrepancies, and a double-entered
 * transaction shown as an ordinary unmatched row because the evidence for
 * calling it a duplicate was a row that had already matched.
 */
import { describe, it, expect } from 'vitest';
import {
  appTxDirection,
  classifyLeftovers,
  findDuplicateRuns,
  DEFAULT_PENDING_GRACE_DAYS,
} from '../leftovers.js';

const row = (id: string, date: string, name: string, amount: number) => ({
  id,
  date,
  name,
  amount,
});

const END = '2026-07-17';

describe('duplicates', () => {
  it('flags a leftover whose twin already matched the statement', () => {
    // The real case: two Acme Vending $4.50 entries on 07-09, one 24 MARKET line
    // on the statement. One matched; the other is a double entry. Its only
    // evidence is the matched row, so a leftovers-only scan cannot see it.
    const leftover = row('b', '2026-07-09', 'Acme Vending', 4.5);
    const matched = row('a', '2026-07-09', 'Acme Vending', 4.5);

    const v = classifyLeftovers([leftover], [matched], END).get('b')!;

    expect(v.kind).toBe('duplicate_in_app');
    expect(v.duplicateOfMatched).toBe(true);
  });

  it('flags the second of two identical leftovers, not the first', () => {
    // One of the pair is presumed real. Calling both duplicates would invite
    // deleting the genuine one too.
    const v = classifyLeftovers(
      [row('a', '2026-03-06', "Queenie's", 3.75), row('b', '2026-03-06', "Queenie's", 3.75)],
      [],
      END,
    );

    expect(v.get('a')!.kind).not.toBe('duplicate_in_app');
    expect(v.get('b')!.kind).toBe('duplicate_in_app');
  });

  it('separates a matched twin from a mere lookalike', () => {
    // The distinction drives how loudly the UI states it: only a matched twin is
    // backed by a charge the bank actually printed.
    const matchedTwin = classifyLeftovers(
      [row('b', '2026-07-09', 'Acme Vending', 4.5)],
      [row('a', '2026-07-09', 'Acme Vending', 4.5)],
      END,
    );
    const lookalike = classifyLeftovers(
      [
        row('a', '2026-02-05', 'Ticketmaster', 419.4),
        row('b', '2026-02-05', 'Ticketmaster', 419.4),
      ],
      [],
      END,
    );

    expect(matchedTwin.get('b')!.duplicateOfMatched).toBe(true);
    expect(lookalike.get('b')!.duplicateOfMatched).toBe(false);
  });

  it('does not call rows duplicates on amount alone', () => {
    // 'a' IS a duplicate — same merchant and cents as the matched row, one day
    // apart. 'b' differs in amount and so explains nothing about it.
    const v = classifyLeftovers(
      [row('a', '2026-03-10', 'Walmart', 10.66), row('b', '2026-03-10', 'Walmart', 10.93)],
      [row('c', '2026-03-11', 'Walmart', 10.66)],
      END,
    );

    expect(v.get('a')!.kind).toBe('duplicate_in_app');
    expect(v.get('b')!.kind).not.toBe('duplicate_in_app');
  });

  it('matches identity on the normalized name, not the raw one', () => {
    const v = classifyLeftovers(
      [row('b', '2026-07-09', 'Acme  Vending!', 4.5)],
      [row('a', '2026-07-09', 'acme vending', 4.5)],
      END,
    );
    expect(v.get('b')!.kind).toBe('duplicate_in_app');
  });
});

describe('pending vs phantom', () => {
  it('treats a charge inside the grace window as merely unposted', () => {
    const v = classifyLeftovers([row('a', '2026-07-16', "Delgado's", 61.25)], [], END);
    expect(v.get('a')!.kind).toBe('missing_in_bank_pending');
  });

  it('treats an older charge as a genuine discrepancy', () => {
    // Five months unposted is not timing.
    const v = classifyLeftovers([row('a', '2026-02-13', 'Amazon', 25.0)], [], END);
    expect(v.get('a')!.kind).toBe('missing_in_bank_phantom');
  });

  it('counts the grace window in both directions', () => {
    // A charge dated after the close plainly has not appeared on it; one dated
    // just before it can post just after.
    const before = classifyLeftovers([row('a', '2026-07-13', 'Etsy', 3.29)], [], END).get('a')!;
    const after = classifyLeftovers([row('a', '2026-07-20', 'Etsy', 3.29)], [], END).get('a')!;

    expect(before.kind).toBe('missing_in_bank_pending');
    expect(after.kind).toBe('missing_in_bank_pending');
  });

  it('puts the boundary exactly at the grace window', () => {
    const inside = classifyLeftovers([row('a', '2026-07-12', 'X', 1)], [], END).get('a')!;
    const outside = classifyLeftovers([row('a', '2026-07-11', 'X', 1)], [], END).get('a')!;

    expect(DEFAULT_PENDING_GRACE_DAYS).toBe(5);
    expect(inside.kind).toBe('missing_in_bank_pending');
    expect(outside.kind).toBe('missing_in_bank_phantom');
  });

  it('calls a duplicate a duplicate even when it is also recent', () => {
    // Both rules apply to the Acme Vending row; the duplicate is the useful
    // thing to say, and "pending" would excuse a double entry as timing.
    const v = classifyLeftovers(
      [row('b', '2026-07-16', 'Delgado', 61.25)],
      [row('a', '2026-07-16', 'Delgado', 61.25)],
      END,
    );
    expect(v.get('b')!.kind).toBe('duplicate_in_app');
  });
});

describe('the shared contract', () => {
  it('returns a verdict for every leftover and none for anything else', () => {
    const v = classifyLeftovers(
      [row('a', '2026-07-01', 'A', 1), row('b', '2026-07-02', 'B', 2)],
      [row('c', '2026-07-03', 'C', 3)],
      END,
    );

    expect([...v.keys()].sort()).toEqual(['a', 'b']);
  });

  it('is unaffected by rows that matched but resemble nothing', () => {
    const withMatched = classifyLeftovers(
      [row('a', '2026-07-01', 'A', 1)],
      [row('z', '2026-07-01', 'Z', 99)],
      END,
    );
    const without = classifyLeftovers([row('a', '2026-07-01', 'A', 1)], [], END);

    expect(withMatched.get('a')).toEqual(without.get('a'));
  });
});

/**
 * A double entry made days apart.
 *
 * The real case: one $16.36 Amazon charge on the statement, two in the app —
 * the 25th and the 30th. The 30th matched; the 25th was reported as an
 * unexplained transaction with no hint that its twin had already been
 * accounted for, because the duplicate check demanded an identical date.
 */
describe('duplicates dated a few days apart', () => {
  const row = (id: string, date: string, name: string, amount: number) => ({
    id,
    date,
    name,
    amount,
  });

  it('flags a leftover whose matched twin is five days earlier', () => {
    const v = classifyLeftovers(
      [row('early', '2026-04-25', 'Amazon', 16.36)],
      [row('matched', '2026-04-30', 'Amazon', 16.36)],
      '2026-07-17',
    );
    expect(v.get('early')!.kind).toBe('duplicate_in_app');
    expect(v.get('early')!.duplicateOfMatched).toBe(true);
  });

  it('stops at the window', () => {
    // Far enough apart to be two genuine purchases the bank happened to print
    // only one of — which is a discrepancy, not a duplicate.
    const v = classifyLeftovers(
      [row('early', '2026-03-01', 'Amazon', 16.36)],
      [row('matched', '2026-04-30', 'Amazon', 16.36)],
      '2026-07-17',
    );
    expect(v.get('early')!.duplicateOfMatched).toBe(false);
  });

  it('still requires the same merchant and the same cents', () => {
    const differentMerchant = classifyLeftovers(
      [row('a', '2026-04-25', 'Amazon', 16.36)],
      [row('b', '2026-04-27', 'Home Depot', 16.36)],
      '2026-07-17',
    );
    const differentAmount = classifyLeftovers(
      [row('a', '2026-04-25', 'Amazon', 16.36)],
      [row('b', '2026-04-27', 'Amazon', 16.35)],
      '2026-07-17',
    );
    expect(differentMerchant.get('a')!.duplicateOfMatched).toBe(false);
    expect(differentAmount.get('a')!.duplicateOfMatched).toBe(false);
  });

  it('does not flag a repeat purchase the bank printed twice', () => {
    // Both app rows matched their own statement line, so neither is a leftover
    // and nothing reaches this check. The bank-side count is what keeps the
    // wider date window safe.
    const v = classifyLeftovers(
      [],
      [row('a', '2026-04-25', 'Amazon', 16.36), row('b', '2026-04-30', 'Amazon', 16.36)],
      '2026-07-17',
    );
    expect(v.size).toBe(0);
  });
});

/**
 * Two rows that net to the same figure are not automatically one purchase.
 *
 * A $25.00 charge and a $40.00 basket part-paid with $15.00 of rewards both
 * reach the card as $25.00. The bank cannot tell them apart and neither could
 * this check, so a pair of entirely different purchases was reported as a
 * double entry — with Delete offered beside it.
 */
describe('rewards make two different purchases look alike', () => {
  const paid = { id: 'paid', date: '2026-02-13', name: 'Amazon', amount: 25.0, gross: 25.0 };
  const rewarded = {
    id: 'rewarded',
    date: '2026-02-13',
    name: 'Amazon',
    amount: 25.0,
    gross: 40.0,
  };

  it('does not call them duplicates of each other', () => {
    const v = classifyLeftovers([rewarded], [paid], '2026-07-17');
    expect(v.get('rewarded')!.duplicateOfMatched).toBe(false);
  });

  it('still catches a real double entry of the rewarded purchase', () => {
    // Same basket, same rewards, entered twice — gross agrees, so it is one.
    const v = classifyLeftovers([{ ...rewarded, id: 'copy' }], [rewarded], '2026-07-17');
    expect(v.get('copy')!.duplicateOfMatched).toBe(true);
  });

  it('falls back to the charged amount when no gross is supplied', () => {
    const v = classifyLeftovers(
      [{ id: 'a', date: '2026-02-13', name: 'Amazon', amount: 25.0 }],
      [{ id: 'b', date: '2026-02-13', name: 'Amazon', amount: 25.0 }],
      '2026-07-17',
    );
    expect(v.get('a')!.duplicateOfMatched).toBe(true);
  });
});

/**
 * A whole period entered twice.
 *
 * The per-row rule above tops out at seven days between a copy and its matched
 * twin, and past that it does not weaken — it goes to nothing. A month re-entered
 * ten or thirty days from the original produced ZERO duplicate verdicts, only a
 * scatter of phantoms and pending rows, which is indistinguishable on screen from
 * a month of real discrepancies.
 *
 * Widening the window is the wrong fix and instructively so: at 45 days an
 * ordinary monthly recurring charge — same merchant, same amount, ~30 days apart,
 * one copy not yet on the statement — becomes a false duplicate, which is advice
 * to delete a real bill. So the window is dropped entirely and the COUNT holds
 * the line instead. One far-twinned row says nothing; five say something no
 * recurring schedule produces.
 */
describe('a re-entered period', () => {
  const MERCHANTS = ['Corner Coffee', 'Zenith Hardware', 'Acme Bakery', 'Vendor Co', 'Harbor Fuel'];

  const shift = (date: string, days: number): string =>
    new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

  /** `count` originals in June, each copied `offsetDays` later. */
  function reentered(count: number, offsetDays: number) {
    const originals = [];
    const copies = [];
    for (let i = 0; i < count; i++) {
      const date = `2026-06-${String(i + 1).padStart(2, '0')}`;
      const name = MERCHANTS[i % MERCHANTS.length]!;
      const amount = Math.round((10 + i * 3.17) * 100) / 100;
      originals.push({ id: `o${i}`, date, name, amount });
      copies.push({ id: `c${i}`, date: shift(date, offsetDays), name, amount });
    }
    return { originals, copies };
  }

  it('catches copies dated thirty days from their originals', () => {
    // The headline gap. Every one of these was a phantom before.
    const { originals, copies } = reentered(24, 30);
    const v = classifyLeftovers(copies, originals, '2026-06-30');

    expect(copies.every((c) => v.get(c.id)!.kind === 'duplicate_in_app')).toBe(true);
    expect(copies.every((c) => v.get(c.id)!.inDuplicateRun)).toBe(true);
    // The per-row rule still cannot see these — the run is what carries them.
    expect(copies.every((c) => v.get(c.id)!.duplicateOfMatched)).toBe(false);
  });

  it('leaves a handful of far-dated lookalikes alone', () => {
    // Four monthly recurring charges whose previous month is unmatched. This is
    // the false positive the count gate exists to prevent, and it is the reason
    // the window could be dropped at all.
    const { originals, copies } = reentered(4, 30);
    const v = classifyLeftovers(copies, originals, '2026-06-30');

    expect(copies.some((c) => v.get(c.id)!.inDuplicateRun)).toBe(false);
    expect(copies.every((c) => v.get(c.id)!.kind !== 'duplicate_in_app')).toBe(true);
  });

  it('catches a bulk re-entry collapsed onto a single date', () => {
    // The other real shape: a month re-typed and dated the day it was typed, so
    // there is no consistent offset to key off. Requiring one would catch the
    // tidy mistake and miss this one.
    const { originals } = reentered(24, 0);
    const copies = originals.map((o, i) => ({ ...o, id: `c${i}`, date: '2026-07-14' }));
    const v = classifyLeftovers(copies, originals, '2026-07-17');

    expect(copies.every((c) => v.get(c.id)!.inDuplicateRun)).toBe(true);
  });

  it('outranks the pending window', () => {
    // A copy dated near the period end would otherwise read "not posted yet" —
    // the one verdict that excuses a row from the remainder, and the worst
    // possible answer for a row that should not exist.
    const { originals } = reentered(24, 0);
    const copies = originals.map((o, i) => ({ ...o, id: `c${i}`, date: '2026-06-29' }));
    const v = classifyLeftovers(copies, originals, '2026-06-30');

    expect(copies.every((c) => v.get(c.id)!.kind === 'duplicate_in_app')).toBe(true);
  });

  it('splits two separately re-entered months into two runs', () => {
    const june = reentered(8, 60);
    const dec = {
      originals: june.originals.map((o, i) => ({ ...o, id: `do${i}`, date: `2026-12-0${i + 1}` })),
      copies: june.copies.map((c, i) => ({ ...c, id: `dc${i}`, date: `2027-02-0${i + 1}` })),
    };
    const runs = findDuplicateRuns(
      [...june.copies, ...dec.copies],
      [...june.originals, ...dec.originals],
    );

    expect(runs).toHaveLength(2);
    // Each run names the span of the ORIGINALS — the period being claimed.
    expect(runs[0]!.start).toBe('2026-06-01');
    expect(runs[1]!.start).toBe('2026-12-01');
  });

  it('does not let one real run vouch for a stray pair in another period', () => {
    // The count gate has to hold per period, not just overall. With a genuine
    // June re-entry present, two far-twinned December lookalikes clear any
    // total-based threshold by riding along — and those two are exactly the
    // monthly-recurring shape the gate exists to refuse.
    const june = reentered(8, 30);
    const strayOriginals = [
      { id: 'so1', date: '2026-12-01', name: 'Streaming Co', amount: 15.99 },
      { id: 'so2', date: '2026-12-02', name: 'Gym Membership', amount: 40 },
    ];
    const strayCopies = strayOriginals.map((o, i) => ({
      ...o,
      id: `sc${i}`,
      date: shift(o.date, 30),
    }));

    const runs = findDuplicateRuns(
      [...june.copies, ...strayCopies],
      [...june.originals, ...strayOriginals],
    );

    expect(runs).toHaveLength(1);
    expect(runs[0]!.rows.map((r) => r.id).sort()).toEqual(june.copies.map((c) => c.id).sort());
  });

  it('reports the period and the money at stake', () => {
    const { originals, copies } = reentered(24, 30);
    const [run] = findDuplicateRuns(copies, originals);

    expect(run!.rows).toHaveLength(24);
    expect(run!.start).toBe('2026-06-01');
    expect(run!.end).toBe('2026-06-24');
    const expected = Math.round(copies.reduce((s, c) => s + c.amount, 0) * 100) / 100;
    expect(run!.total).toBeCloseTo(expected, 2);
  });

  it('needs a matched twin, not merely a lookalike among the leftovers', () => {
    // The evidence for a re-entry is that the bank printed each row ONCE while
    // the app holds it twice, and only a MATCHED twin establishes that. These
    // leftovers are deliberately built as 12 lookalike pairs, so an
    // implementation that let leftovers vouch for each other would find a run of
    // 24 here. Nothing matched, so there is no such evidence and no run.
    const { originals } = reentered(12, 0);
    const pairs = [
      ...originals.map((o, i) => ({ ...o, id: `p${i}` })),
      ...originals.map((o, i) => ({ ...o, id: `q${i}`, date: shift(o.date, 30) })),
    ];
    expect(findDuplicateRuns(pairs, [])).toEqual([]);
  });

  it('claims only the rows in the run, leaving other leftovers alone', () => {
    // A re-entered month sitting beside genuine unmatched rows. The run must not
    // sweep up its neighbours — those are real discrepancies and have to keep
    // reporting as such.
    const { originals, copies } = reentered(24, 30);
    const strangers = [
      { id: 'x1', date: '2026-06-05', name: 'Lumen Books', amount: 9.99 },
      { id: 'x2', date: '2026-06-06', name: 'Bright Pharmacy', amount: 41.2 },
    ];
    const v = classifyLeftovers([...copies, ...strangers], originals, '2026-06-30');

    expect(copies.every((c) => v.get(c.id)!.inDuplicateRun)).toBe(true);
    expect(strangers.every((s) => v.get(s.id)!.inDuplicateRun)).toBe(false);
    expect(strangers.every((s) => v.get(s.id)!.kind === 'missing_in_bank_phantom')).toBe(true);
  });
});

/**
 * Direction is the one thing a $20 charge and a $20 credit disagree on, so the
 * matcher lives or dies by this rule. The trade cases are the point: on Cash Wallet
 * the broker IS the reconciled account, so a sell deposits dollars and must read
 * as a credit — the case a `type`-only rule silently got wrong.
 */
describe('appTxDirection', () => {
  it('charges an expense and credits income and refunds', () => {
    expect(appTxDirection({ type: 'EXPENSE', inbound: false })).toBe('charge');
    expect(appTxDirection({ type: 'INCOME', inbound: false })).toBe('credit');
    expect(appTxDirection({ type: 'REFUND', inbound: false })).toBe('credit');
  });

  it('signs a transfer by which side of it this account is on', () => {
    // Source side spends; the destination side (inbound) receives.
    expect(appTxDirection({ type: 'TRANSFER', inbound: false })).toBe('charge');
    expect(appTxDirection({ type: 'TRANSFER', inbound: true })).toBe('credit');
  });

  it('charges a trade BUY and credits a trade SELL', () => {
    expect(appTxDirection({ type: 'TRADE', inbound: false, tradeDirection: 'BUY' })).toBe('charge');
    expect(appTxDirection({ type: 'TRADE', inbound: false, tradeDirection: 'SELL' })).toBe(
      'credit',
    );
  });

  it('charges a trade with no or unknown direction rather than guessing credit', () => {
    // A missing/garbled direction degrades to "not a sell" — the safe default,
    // matching the balance hook, which only credits an explicit SELL.
    expect(appTxDirection({ type: 'TRADE', inbound: false, tradeDirection: null })).toBe('charge');
    expect(appTxDirection({ type: 'TRADE', inbound: false })).toBe('charge');
  });
});
