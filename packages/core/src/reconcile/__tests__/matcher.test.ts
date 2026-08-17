/**
 * Structural fixtures for the reconciliation matcher.
 *
 * Every merchant, amount, and date here is fabricated — real statement data
 * never enters version control (Requirement 8.1). What each fixture reproduces
 * is a *structural pattern* that defeated a naive matcher on real data, so the
 * shapes are real even though the values are not.
 *
 * These must pass standalone, with no local-only fixtures present.
 */
import { describe, it, expect } from 'vitest';
import { reconcile } from '../matcher.js';
import { nameSimilarity, normalizeName, dayDiff } from '../name-similarity.js';
import type { AppTx, Finding, StatementLine } from '../types.js';

const END = '2026-06-30';

function stmt(date: string, description: string, amount: number, credit = false): StatementLine {
  return { date, description, amount, direction: credit ? 'credit' : 'charge' };
}

let seq = 0;
function tx(date: string, name: string, amount: number, credit = false): AppTx {
  return { id: `t${++seq}`, date, name, amount, direction: credit ? 'credit' : 'charge' };
}

function run(statement: StatementLine[], app: AppTx[], options = {}) {
  return reconcile({ statement, app, endDate: END, options });
}

const kinds = (findings: Finding[]): string[] => findings.map((f) => f.kind).sort();

describe('exact matching', () => {
  it('pairs identical rows and leaves no remainder', () => {
    const r = run(
      [stmt('2026-06-10', 'ACME BAKERY', 24.5)],
      [tx('2026-06-10', 'Acme Bakery', 24.5)],
    );
    expect(kinds(r.findings)).toEqual(['matched']);
    expect(r.remainder).toBe(0);
  });

  it('tolerates posting lag within the date window', () => {
    const r = run(
      [stmt('2026-06-12', 'ACME BAKERY', 24.5)],
      [tx('2026-06-10', 'Acme Bakery', 24.5)],
    );
    expect(kinds(r.findings)).toEqual(['matched']);
  });
});

describe('bank descriptors with near-zero name similarity', () => {
  it('matches on amount and date even when the names do not resemble each other', () => {
    // The pattern: a processor prefix and an unrelated legal entity. Gating on
    // name similarity here rejects a correct match — name is a tiebreaker only.
    const bank = 'SQ *ZZQX HOLDINGS LLC';
    const app = 'Corner Coffee';
    expect(nameSimilarity(bank, app)).toBeLessThan(0.3);

    const r = run([stmt('2026-06-05', bank, 7.25)], [tx('2026-06-05', app, 7.25)]);
    // Paired, and flagged as a label discrepancy rather than a money one.
    expect(kinds(r.findings)).toEqual(['name_mismatch']);
    expect(r.remainder).toBe(0);
  });

  it('prefers the better-named candidate when amounts tie', () => {
    // Two same-amount charges on one day; name must break the tie correctly.
    const r = run(
      [stmt('2026-06-08', 'CORNER COFFEE', 5)],
      [tx('2026-06-08', 'Zenith Hardware', 5), tx('2026-06-08', 'Corner Coffee', 5)],
    );
    const matched = r.findings.find((f) => f.kind === 'matched');
    expect(matched?.app?.name).toBe('Corner Coffee');
  });
});

describe('multi-part sum grouping', () => {
  it('groups six app rows against one statement line', () => {
    // The pattern that defeated maxSumParts=4: one refund line covering six
    // separate returns. At a lower cap this reports as 1 mispair + 5 missing.
    const parts = [10.94, 10.94, 14.18, 6.55, 25.74, 7.65];
    const total = parts.reduce((a, b) => a + b, 0); // 76.00
    const r = run(
      [stmt('2026-06-15', 'ZENITH RETURNS', total, true)],
      parts.map((p) => tx('2026-06-15', 'Zenith Refund', p, true)),
    );
    expect(kinds(r.findings)).toEqual(['grouped_in_app']);
    expect(r.findings[0]!.apps).toHaveLength(6);
    expect(r.remainder).toBe(0);
  });

  it('cannot reach the grouping when maxSumParts is too low', () => {
    // Pins the reason for the default: this is the pre-fix behaviour.
    const parts = [10.94, 10.94, 14.18, 6.55, 25.74, 7.65];
    const total = parts.reduce((a, b) => a + b, 0);
    const r = run(
      [stmt('2026-06-15', 'ZENITH RETURNS', total, true)],
      parts.map((p) => tx('2026-06-15', 'Zenith Refund', p, true)),
      { maxSumParts: 4 },
    );
    expect(r.findings.some((f) => f.kind === 'grouped_in_app')).toBe(false);
  });

  it('groups several statement lines against one app row', () => {
    const r = run(
      [
        stmt('2026-06-20', 'CITY UTILITIES WATER', 40.15),
        stmt('2026-06-20', 'CITY UTILITIES SEWER', 61.4),
        stmt('2026-06-20', 'CITY UTILITIES TRASH', 35.35),
      ],
      [tx('2026-06-20', 'City Utilities', 136.9)],
    );
    expect(kinds(r.findings)).toEqual(['grouped_in_bank']);
    expect(r.findings[0]!.statements).toHaveLength(3);
    expect(r.remainder).toBe(0);
  });
});

describe('amount discrepancies', () => {
  it('flags a small entry error and reports its delta', () => {
    const r = run(
      [stmt('2026-06-11', 'ZENITH HARDWARE', 42.29)],
      [tx('2026-06-11', 'Zenith Hardware', 42.0)],
    );
    expect(kinds(r.findings)).toEqual(['amount_mismatch']);
    expect(r.findings[0]!.delta).toBeCloseTo(-0.29, 2);
  });

  it('defers amount_differs so grouping wins when both could apply', () => {
    // The app row could pair as a near-miss with any single statement line, but
    // the group explains all of them. Grouping must win; otherwise one clean
    // grouping becomes a mispair plus orphans.
    const r = run(
      [
        stmt('2026-06-18', 'ZENITH RETURNS', 30, true),
        stmt('2026-06-18', 'ZENITH RETURNS', 46, true),
      ],
      [tx('2026-06-18', 'Zenith Returns', 76, true)],
    );
    expect(kinds(r.findings)).toEqual(['grouped_in_bank']);
  });
});

describe('wrong-direction transfer', () => {
  it('flags a reversed payment and doubles its balance impact', () => {
    // Recorded leaving the account when it actually arrived.
    const r = run(
      [stmt('2026-06-04', 'PAYMENT THANK YOU', 2470.54, true)],
      [tx('2026-06-04', 'Card Payment', 2470.54, false)],
    );
    expect(kinds(r.findings)).toEqual(['sign_flip']);
    expect(r.findings[0]!.delta).toBeCloseTo(4941.08, 2);
  });
});

describe('timing artifacts', () => {
  it('treats recent unposted rows as pending, not phantoms', () => {
    const r = run([], [tx('2026-06-29', 'Corner Coffee', 12.4)]);
    expect(kinds(r.findings)).toEqual(['missing_in_bank_pending']);
    // Pending rows are expected, so they must not move the remainder.
    expect(r.remainder).toBe(0);
  });

  it('treats older unposted rows as phantoms', () => {
    const r = run([], [tx('2026-06-01', 'Corner Coffee', 12.4)]);
    expect(kinds(r.findings)).toEqual(['missing_in_bank_phantom']);
    expect(r.remainder).toBeCloseTo(12.4, 2);
  });

  it('pins the pending total for a known set of rows', () => {
    const amounts = [12.4, 30.11, 8.5];
    const r = run(
      [],
      amounts.map((a) => tx('2026-06-29', 'Corner Coffee', a)),
    );
    expect(r.findings.every((f) => f.kind === 'missing_in_bank_pending')).toBe(true);
    const total = Math.round(r.findings.reduce((s, f) => s - f.app!.amount, 0) * 100) / 100;
    expect(total).toBeCloseTo(-51.01, 2);
  });
});

describe('duplicates and gaps', () => {
  it('marks a second identical app row as a duplicate', () => {
    const r = run(
      [stmt('2026-06-09', 'CORNER COFFEE', 5)],
      [tx('2026-06-09', 'Corner Coffee', 5), tx('2026-06-09', 'Corner Coffee', 5)],
    );
    expect(kinds(r.findings)).toEqual(['duplicate_in_app', 'matched']);
  });

  it('reports a statement line with no app counterpart', () => {
    const r = run([stmt('2026-06-14', 'UNKNOWN VENDOR', 88.2)], []);
    expect(kinds(r.findings)).toEqual(['missing_in_app']);
    expect(r.findings[0]!.delta).toBeCloseTo(-88.2, 2);
  });
});

describe('determinism', () => {
  it('produces identical output for identical input', () => {
    const statement = [
      stmt('2026-06-10', 'ACME BAKERY', 24.5),
      stmt('2026-06-11', 'CORNER COFFEE', 5),
    ];
    const app = [tx('2026-06-10', 'Acme Bakery', 24.5), tx('2026-06-11', 'Corner Coffee', 5)];
    const a = reconcile({ statement, app, endDate: END });
    const b = reconcile({ statement, app, endDate: END });
    expect(a.summary).toEqual(b.summary);
    expect(a.remainder).toBe(b.remainder);
    expect(a.findings.map((f) => f.kind)).toEqual(b.findings.map((f) => f.kind));
  });

  it('does not depend on the current date', () => {
    // endDate is required precisely so the clock cannot influence the result.
    const app = [tx('2026-06-29', 'Corner Coffee', 12.4)];
    const near = reconcile({ statement: [], app, endDate: '2026-06-30' });
    const far = reconcile({ statement: [], app, endDate: '2026-12-31' });
    expect(near.findings[0]!.kind).toBe('missing_in_bank_pending');
    expect(far.findings[0]!.kind).toBe('missing_in_bank_phantom');
  });
});

describe('name normalization', () => {
  it('strips store numbers and card-processing noise', () => {
    expect(normalizeName('ACME BAKERY #2938 PURCHASE')).toBe('acme bakery');
    expect(normalizeName('POS DEBIT CORNER COFFEE')).toBe('corner coffee');
  });

  it('scores identical names at 1 and unrelated ones near 0', () => {
    expect(nameSimilarity('Acme Bakery', 'ACME BAKERY')).toBe(1);
    expect(nameSimilarity('Acme Bakery', 'Zenith Hardware')).toBeLessThan(0.3);
  });

  it('measures whole days in UTC regardless of host timezone', () => {
    expect(dayDiff('2026-06-30', '2026-07-01')).toBe(1);
    expect(dayDiff('2026-07-01', '2026-06-30')).toBe(1);
    expect(dayDiff('2026-06-30', '2026-06-30')).toBe(0);
  });
});

/**
 * When two app rows compete for one statement line, which wins: the exact cent
 * dated a few days off, or the near-miss dated close?
 *
 * Preferring the near-miss consumed the statement row and orphaned the real
 * match, so ONE transaction produced both a false "amounts differ" and a false
 * "missing from the statement".
 */
describe('exact amount versus close date', () => {
  it('prefers the exact cent within ordinary posting lag', () => {
    const { findings } = run(
      [stmt('2026-06-11', 'Vendor.com*318JI3743', 25.44)],
      [
        // Dated 5 days earlier but exact to the cent — routine posting lag.
        tx('2026-06-06', 'Vendor', 25.44),
        // Two days away and within the ±0.50 tolerance, but a different amount.
        tx('2026-06-13', 'Vendor', 25.0),
      ],
    );

    const paired = findings.find((f) => f.app?.amount === 25.44);
    expect(paired).toBeDefined();
    expect(paired!.kind).toBe('date_far');

    // The near-miss is left over as its own row, not fused onto the statement.
    const mismatch = findings.find((f) => f.kind === 'amount_mismatch');
    expect(mismatch).toBeUndefined();
  });

  it('prefers the close near-miss once the exact match is far away', () => {
    const { findings } = run(
      [stmt('2026-06-11', 'Vendor', 25.44)],
      [
        // 26 days out — more likely a different purchase of the same price.
        tx('2026-05-16', 'Vendor', 25.44),
        tx('2026-06-11', 'Vendor', 25.0),
      ],
    );

    const paired = findings.find((f) => f.statement?.amount === 25.44 && f.app);
    expect(paired?.kind).toBe('amount_mismatch');
    expect(paired?.app?.amount).toBe(25.0);
  });

  it('still prefers a same-day exact match over everything', () => {
    const { findings } = run(
      [stmt('2026-06-11', 'Vendor', 25.44)],
      [tx('2026-06-11', 'Vendor', 25.44), tx('2026-06-11', 'Vendor', 25.0)],
    );
    const paired = findings.find((f) => f.app?.amount === 25.44);
    expect(paired?.kind).toBe('matched');
  });
});

describe('trades whose computed amount drifts from the settled amount', () => {
  /*
   * A trade's app amount is `unitPrice × quantity` rounded to cents; the broker
   * settles at the actual fill. The two disagree by a couple of cents on rows
   * that are otherwise a perfect match, and the name gate that normally protects
   * an approximate pairing is unreachable — brokerage descriptors name the full
   * legal instrument, which shares almost nothing with a "Buy XYZ" app row.
   *
   * Values are fabricated but the shape is the one observed on real data.
   */
  const BROKER_BUY = 'Purchase of Zenith Variable Rate Perpetual Stretch Preferred Stock';
  const BROKER_SELL = 'Sale of Zenith Variable Rate Perpetual Stretch Preferred Stock';

  function trade(date: string, name: string, amount: number, credit = false): AppTx {
    return { ...tx(date, name, amount, credit), isTrade: true };
  }

  it('the descriptor really is below the name gate', () => {
    // If this ever stops being true the rest of this block proves nothing —
    // the pairings would be explained by the ordinary named path.
    expect(nameSimilarity(BROKER_BUY, 'Buy ZNTH')).toBeLessThan(0.55);
    expect(nameSimilarity(BROKER_SELL, 'Sell ZNTH')).toBeLessThan(0.55);
  });

  it('pairs a buy that settled two cents under the recorded amount', () => {
    const r = run([stmt('2026-06-09', BROKER_BUY, 99.7)], [trade('2026-06-09', 'Buy ZNTH', 99.72)]);

    expect(kinds(r.findings)).toEqual(['amount_mismatch']);
    // The pairing explains the difference; it must not absorb it.
    expect(r.remainder).toBeCloseTo(0.02, 2);
    expect(r.findings[0]!.note).toMatch(/unit price/i);
  });

  it('pairs a sell that settled two cents over the recorded amount', () => {
    // The credit direction, which is where a sell mis-signs if direction is
    // taken from the type alone.
    const r = run(
      [stmt('2026-06-09', BROKER_SELL, 402.25, true)],
      [trade('2026-06-09', 'Sell ZNTH', 402.23, true)],
    );

    expect(kinds(r.findings)).toEqual(['amount_mismatch']);
    expect(r.remainder).toBeCloseTo(0.02, 2);
  });

  it('leaves a non-trade near-miss with an unrelated name unpaired', () => {
    // The control. Identical amounts, dates, and direction to the buy case —
    // only `isTrade` differs. Without it the name gate still applies, so this
    // must NOT pair, or the relaxation is leaking to every row.
    const r = run([stmt('2026-06-09', BROKER_BUY, 99.7)], [tx('2026-06-09', 'Buy ZNTH', 99.72)]);

    expect(kinds(r.findings)).toEqual(['missing_in_app', 'missing_in_bank_phantom']);
  });

  it('does not pair a trade drifting further than a few cents', () => {
    // $0.40 is inside the ordinary $0.50 typo tolerance but far outside the
    // trade band, so a real difference stays visible instead of being explained
    // away as rounding.
    const r = run(
      [stmt('2026-06-09', BROKER_BUY, 99.32)],
      [trade('2026-06-09', 'Buy ZNTH', 99.72)],
    );

    expect(kinds(r.findings)).toEqual(['missing_in_app', 'missing_in_bank_phantom']);
  });

  it('does not pair a trade against the opposite direction', () => {
    const r = run(
      [stmt('2026-06-09', BROKER_SELL, 99.7, true)],
      [trade('2026-06-09', 'Buy ZNTH', 99.72)],
    );

    expect(kinds(r.findings)).toEqual(['missing_in_app', 'missing_in_bank_phantom']);
  });

  it('does not pair a trade outside the date window', () => {
    const r = run([stmt('2026-06-20', BROKER_BUY, 99.7)], [trade('2026-06-09', 'Buy ZNTH', 99.72)]);

    expect(kinds(r.findings)).toEqual(['missing_in_app', 'missing_in_bank_phantom']);
  });

  it('still prefers an exact statement line over the trade near-miss', () => {
    // Two statement lines compete for one trade. The cent-exact one wins, and
    // the near-miss is left as its own finding rather than fused on.
    const r = run(
      [stmt('2026-06-09', BROKER_BUY, 99.7), stmt('2026-06-09', 'ZNTH BUY', 99.72)],
      [trade('2026-06-09', 'Buy ZNTH', 99.72)],
    );

    const paired = r.findings.find((f) => f.app);
    expect(paired?.kind).toBe('matched');
    expect(paired?.statement?.amount).toBe(99.72);
    expect(r.findings.some((f) => f.kind === 'missing_in_app')).toBe(true);
  });

  it('prefers the named candidate when a trade and an ordinary row both fit', () => {
    // Name is still the tiebreaker among equals — dropping the gate for trades
    // must not promote them above a better-named competitor.
    const r = run(
      [stmt('2026-06-09', 'ZENITH HARDWARE', 99.7)],
      [trade('2026-06-09', 'Buy ZNTH', 99.72), tx('2026-06-09', 'Zenith Hardware', 99.68)],
    );

    const paired = r.findings.find((f) => f.kind === 'amount_mismatch');
    expect(paired?.app?.name).toBe('Zenith Hardware');
  });
});
