/**
 * Hints point at leftovers the matcher could not pair. They must never be
 * confident — a wrong hint costs a glance, a wrong match costs money — but they
 * must fire on the shapes that actually occur: the same charge entered twice,
 * and one line recorded as several.
 */
import { describe, it, expect } from 'vitest';
import { findDuplicates, findCombinations, findReversals, findClusters } from '../hints.js';

const row = (id: string, date: string, amount: number) => ({ id, date, amount });

/** Same, but with the direction the money moved. */
const signed = (id: string, date: string, amount: number, direction: 'charge' | 'credit') => ({
  id,
  date,
  amount,
  direction,
});

/**
 * Amounts reach the hint layer with their sign stripped, so a purchase and the
 * refund that reversed it are identical numbers on identical dates. They are
 * the opposite of a duplicate — one cancels the other — and calling them one
 * invites deleting half of a correctly recorded pair.
 */
describe('direction', () => {
  it('does not call a charge and its refund duplicates', () => {
    const groups = findDuplicates([
      signed('sale', '2026-05-02', 28.85, 'charge'),
      signed('refund', '2026-05-02', 28.85, 'credit'),
    ]);
    expect(groups).toHaveLength(0);
  });

  it('still groups two charges of the same amount', () => {
    const groups = findDuplicates([
      signed('a', '2026-05-02', 28.85, 'charge'),
      signed('b', '2026-05-02', 28.85, 'charge'),
    ]);
    expect(groups[0]!.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('groups two refunds of the same amount', () => {
    const groups = findDuplicates([
      signed('a', '2026-05-02', 28.85, 'credit'),
      signed('b', '2026-05-02', 28.85, 'credit'),
    ]);
    expect(groups[0]!.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('does not build a combination out of opposing directions', () => {
    // 10 + 15 only "explains" a 25 charge if both parts are charges. A refund
    // is not an ingredient of a purchase.
    const combos = findCombinations(
      [signed('target', '2026-05-02', 25, 'charge')],
      [signed('p1', '2026-05-02', 10, 'charge'), signed('p2', '2026-05-02', 15, 'credit')],
    );
    expect(combos).toHaveLength(0);
  });

  it('falls back to the old behaviour when direction is unknown', () => {
    // A caller with no direction still gets hints rather than none.
    const groups = findDuplicates([row('a', '2026-05-02', 28.85), row('b', '2026-05-02', 28.85)]);
    expect(groups).toHaveLength(1);
  });
});

/**
 * A charge and the refund that undid it are one non-event. This is the only
 * hint whose advice is "do nothing", so its bar is the highest: a coincidental
 * pair would excuse a real discrepancy rather than merely mislabel one.
 */
describe('findReversals', () => {
  const labelled = (
    id: string,
    date: string,
    amount: number,
    direction: 'charge' | 'credit',
    label: string,
  ) => ({ id, date, amount, direction, label });

  it('pairs a charge with its same-day refund', () => {
    const out = findReversals([
      labelled('sale', '2026-05-03', 28.85, 'charge', 'aliexpress'),
      labelled('refund', '2026-05-03', 28.85, 'credit', 'aliexpress'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.charge.id).toBe('sale');
    expect(out[0]!.credit.id).toBe('refund');
  });

  it('pairs a refund that posted a few days later', () => {
    const out = findReversals([
      labelled('sale', '2026-05-03', 28.85, 'charge', 'aliexpress'),
      labelled('refund', '2026-05-05', 28.85, 'credit', 'aliexpress'),
    ]);
    expect(out).toHaveLength(1);
  });

  it('will not pair across different merchants', () => {
    // Same amount, same day, opposite directions — and unrelated. Calling this
    // a wash would tell the user to ignore two genuine discrepancies.
    const out = findReversals([
      labelled('a', '2026-05-03', 28.85, 'charge', 'aliexpress'),
      labelled('b', '2026-05-03', 28.85, 'credit', 'Home Depot'),
    ]);
    expect(out).toHaveLength(0);
  });

  it('will not pair when a descriptor is missing', () => {
    // Silence is not evidence. Without both names the claim cannot be made
    // safely, so it is not made at all.
    const out = findReversals([
      { id: 'a', date: '2026-05-03', amount: 28.85, direction: 'charge' },
      { id: 'b', date: '2026-05-03', amount: 28.85, direction: 'credit' },
    ]);
    expect(out).toHaveLength(0);
  });

  it('will not pair beyond the date window', () => {
    const out = findReversals([
      labelled('sale', '2026-05-03', 28.85, 'charge', 'aliexpress'),
      labelled('refund', '2026-05-20', 28.85, 'credit', 'aliexpress'),
    ]);
    expect(out).toHaveLength(0);
  });

  it('will not pair different amounts', () => {
    // A partial refund is NOT a wash — the difference is a real balance change
    // the user still has to account for.
    const out = findReversals([
      labelled('sale', '2026-05-03', 28.85, 'charge', 'aliexpress'),
      labelled('refund', '2026-05-03', 20.0, 'credit', 'aliexpress'),
    ]);
    expect(out).toHaveLength(0);
  });

  it('claims each row once', () => {
    // Two charges and one refund: only one pair is offerable, and suggesting
    // the same refund against both is advice that cannot be taken twice.
    const out = findReversals([
      labelled('s1', '2026-05-03', 28.85, 'charge', 'aliexpress'),
      labelled('s2', '2026-05-03', 28.85, 'charge', 'aliexpress'),
      labelled('r1', '2026-05-03', 28.85, 'credit', 'aliexpress'),
    ]);
    expect(out).toHaveLength(1);
  });

  it('pairs two independent reversals separately', () => {
    const out = findReversals([
      labelled('s1', '2026-05-03', 28.85, 'charge', 'aliexpress'),
      labelled('r1', '2026-05-03', 28.85, 'credit', 'aliexpress'),
      labelled('s2', '2026-05-04', 14.0, 'charge', 'Etsy'),
      labelled('r2', '2026-05-04', 14.0, 'credit', 'Etsy'),
    ]);
    expect(out).toHaveLength(2);
  });
});

describe('findDuplicates', () => {
  it('groups two identical charges on the same day', () => {
    const groups = findDuplicates([
      row('a', '2026-06-10', 3.75),
      row('b', '2026-06-10', 3.75),
      row('c', '2026-06-10', 9.0),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('groups three of the same', () => {
    const groups = findDuplicates([
      row('a', '2026-06-10', 3.75),
      row('b', '2026-06-10', 3.75),
      row('c', '2026-06-10', 3.75),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
  });

  it('ignores amounts that differ by a cent', () => {
    expect(
      findDuplicates([row('a', '2026-06-10', 3.75), row('b', '2026-06-10', 3.76)]),
    ).toHaveLength(0);
  });

  it('ignores rows dated beyond the window', () => {
    expect(
      findDuplicates([row('a', '2026-06-10', 3.75), row('b', '2026-06-20', 3.75)]),
    ).toHaveLength(0);
  });

  it('claims each row once so groups never overlap', () => {
    const groups = findDuplicates([
      row('a', '2026-06-10', 3.75),
      row('b', '2026-06-10', 3.75),
      row('c', '2026-06-10', 3.75),
      row('d', '2026-06-10', 3.75),
    ]);
    const ids = groups.flat().map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('says nothing when everything is distinct', () => {
    expect(findDuplicates([row('a', '2026-06-10', 1), row('b', '2026-06-10', 2)])).toHaveLength(0);
  });
});

describe('findCombinations', () => {
  it('spots one line recorded as two entries', () => {
    // The concert tickets: one $600.00 statement line, two $300.00 app rows.
    const combos = findCombinations(
      [row('bank', '2026-02-08', 600)],
      [row('app1', '2026-02-05', 300), row('app2', '2026-02-05', 300)],
    );
    expect(combos).toHaveLength(1);
    expect(combos[0]!.parts.map((p) => p.id).sort()).toEqual(['app1', 'app2']);
  });

  it('spots one entry covering two lines', () => {
    // Metro Mobile: one $780 app row, two $390 statement lines.
    const combos = findCombinations(
      [row('app', '2026-06-10', 780)],
      [row('bank1', '2026-06-10', 390), row('bank2', '2026-06-11', 390)],
    );
    expect(combos).toHaveLength(1);
    expect(combos[0]!.parts).toHaveLength(2);
  });

  it('requires an exact sum', () => {
    expect(
      findCombinations(
        [row('bank', '2026-06-10', 600)],
        [row('a', '2026-06-10', 300), row('b', '2026-06-10', 299.6)],
      ),
    ).toHaveLength(0);
  });

  it('never suggests a single row as a combination', () => {
    // One row equalling the target is a plain match, not a combination — and
    // the matcher would already have paired it.
    expect(
      findCombinations([row('bank', '2026-06-10', 300)], [row('a', '2026-06-10', 300)]),
    ).toHaveLength(0);
  });

  it('ignores parts dated outside the window', () => {
    expect(
      findCombinations(
        [row('bank', '2026-06-10', 600)],
        [row('a', '2026-06-10', 300), row('b', '2026-06-30', 300)],
      ),
    ).toHaveLength(0);
  });

  it('offers each part to only one combination', () => {
    const combos = findCombinations(
      [row('t1', '2026-06-10', 20), row('t2', '2026-06-10', 20)],
      [
        row('p1', '2026-06-10', 10),
        row('p2', '2026-06-10', 10),
        row('p3', '2026-06-10', 10),
        row('p4', '2026-06-10', 10),
      ],
    );
    const used = combos.flatMap((c) => c.parts.map((p) => p.id));
    expect(new Set(used).size).toBe(used.length);
  });

  it('respects the parts cap', () => {
    // 4 parts needed, cap is 3.
    expect(
      findCombinations(
        [row('bank', '2026-06-10', 40)],
        [
          row('a', '2026-06-10', 10),
          row('b', '2026-06-10', 10),
          row('c', '2026-06-10', 10),
          row('d', '2026-06-10', 10),
        ],
        { maxCombinationParts: 3 },
      ),
    ).toHaveLength(0);
  });
});

/**
 * Clusters point at same-merchant leftovers that do NOT reconcile — the case a
 * combination cannot explain because the parts do not sum. They assert nothing;
 * a cluster is a spotlight on two sides and the gap between them. The name is the
 * only anchor, so the bar is the strong one, and it must span both sides.
 */
describe('findClusters', () => {
  const at = (
    id: string,
    date: string,
    amount: number,
    label: string,
    direction: 'charge' | 'credit' = 'charge',
  ) => ({ id, date, amount, label, direction });

  it('groups the the water utility case: one bank line, two app rows, do not sum', () => {
    // Same merchant, same direction, near in time — but 75 + 70 ≠ 150, so
    // findCombinations declined them and they landed on opposite sides.
    const clusters = findClusters(
      [at('bank', '2026-05-10', 150, 'CITYWATER UTIL')],
      [at('a', '2026-05-09', 75, 'CityWater'), at('b', '2026-05-11', 70, 'CityWater')],
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.statements.map((r) => r.id)).toEqual(['bank']);
    expect(clusters[0]!.apps.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('will not cluster a one-sided group', () => {
    // Two app "CityWater" rows and no statement counterpart: there is no gap to
    // show, so nothing is surfaced.
    const clusters = findClusters(
      [],
      [at('a', '2026-05-09', 75, 'CityWater'), at('b', '2026-05-11', 70, 'CityWater')],
    );
    expect(clusters).toHaveLength(0);
  });

  it('will not cluster different merchants that happen to align', () => {
    const clusters = findClusters(
      [at('bank', '2026-05-10', 150, 'Home Depot')],
      [at('a', '2026-05-10', 75, 'CityWater'), at('b', '2026-05-10', 70, 'CityWater')],
    );
    // The bank line joins nothing; the two the water utility rows are one-sided.
    expect(clusters).toHaveLength(0);
  });

  it('will not cluster when a label is missing (silence is not evidence)', () => {
    const clusters = findClusters(
      [{ id: 'bank', date: '2026-05-10', amount: 150, direction: 'charge' as const }],
      [at('a', '2026-05-10', 75, 'CityWater'), at('b', '2026-05-10', 70, 'CityWater')],
    );
    expect(clusters).toHaveLength(0);
  });

  it('will not cross directions: a charge and a refund are not one cluster', () => {
    const clusters = findClusters(
      [at('bank', '2026-05-10', 150, 'CityWater', 'charge')],
      [
        at('a', '2026-05-10', 75, 'CityWater', 'charge'),
        at('b', '2026-05-10', 70, 'CityWater', 'credit'),
      ],
    );
    // Only the same-direction app row links to the bank line, so the cluster is
    // the bank + the one charge; the refund is excluded.
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.apps.map((r) => r.id)).toEqual(['a']);
  });

  it('will not cluster beyond the date window', () => {
    const clusters = findClusters(
      [at('bank', '2026-05-10', 150, 'CityWater')],
      [at('a', '2026-05-30', 75, 'CityWater'), at('b', '2026-05-31', 70, 'CityWater')],
    );
    expect(clusters).toHaveLength(0);
  });

  it('requires the strong name bar — a weak resemblance is not a cluster', () => {
    const clusters = findClusters(
      [at('bank', '2026-05-10', 150, 'CityWater')],
      [at('a', '2026-05-10', 75, 'Broadway Cafe')],
    );
    expect(clusters).toHaveLength(0);
  });

  it('returns two distinct merchant clusters separately', () => {
    const clusters = findClusters(
      [at('u1', '2026-05-10', 150, 'CityWater'), at('n1', '2026-05-12', 90, 'Netflix')],
      [
        at('u-a', '2026-05-10', 75, 'CityWater'),
        at('u-b', '2026-05-10', 70, 'CityWater'),
        at('n-a', '2026-05-12', 45, 'Netflix'),
        at('n-b', '2026-05-12', 40, 'Netflix'),
      ],
    );
    expect(clusters).toHaveLength(2);
    const byMerchant = Object.fromEntries(
      clusters.map((c) => [c.statements[0]!.label, c.apps.length]),
    );
    expect(byMerchant).toEqual({ CityWater: 2, Netflix: 2 });
  });

  it('handles several statement lines for the same merchant on one side', () => {
    const clusters = findClusters(
      [at('s1', '2026-05-10', 100, 'CityWater'), at('s2', '2026-05-11', 50, 'CityWater')],
      [at('a', '2026-05-10', 120, 'CityWater')],
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.statements.map((r) => r.id).sort()).toEqual(['s1', 's2']);
    expect(clusters[0]!.apps.map((r) => r.id)).toEqual(['a']);
  });
});
