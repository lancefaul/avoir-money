/**
 * Differential fixture for `classifyLeftovers` and `findDuplicateRuns`.
 *
 * Scenario-driven rather than random: the verdicts turn on structural
 * relationships between rows (a twin that matched, a repeated identity, a run
 * of five), and random rows almost never produce those. Each case below is one
 * shape the classifier has to get right.
 *
 * Synthetic merchants, for the same reason as the name fixture.
 *
 *   node rust/core/tests/fixtures/generate-leftovers.mjs > leftover_vectors.json
 */
import { classifyLeftovers, findDuplicateRuns } from '../../../../packages/core/dist/index.js';

const END = '2026-06-30';
const row = (id, date, name, amount, gross) => ({
  id,
  date,
  name,
  amount,
  ...(gross !== undefined ? { gross } : {}),
});

const cases = [];
const add = (name, leftovers, matched, opts = {}) => {
  const verdicts = classifyLeftovers(
    leftovers,
    matched,
    END,
    opts.pendingGraceDays ?? 5,
    opts.duplicateWindowDays ?? 7,
    opts.run ?? {},
  );
  const runs = findDuplicateRuns(leftovers, matched, opts.run ?? {});
  cases.push({
    name,
    in: {
      leftovers,
      matched,
      endDate: END,
      pendingGraceDays: opts.pendingGraceDays ?? 5,
      duplicateWindowDays: opts.duplicateWindowDays ?? 7,
      run: opts.run ?? {},
    },
    out: {
      verdicts: [...verdicts.entries()].map(([id, v]) => ({ id, ...v })),
      runs: runs.map((r) => ({
        rows: r.rows.map((x) => x.id),
        start: r.start,
        end: r.end,
        total: r.total,
      })),
    },
  });
};

// A leftover whose twin matched -> duplicate.
add(
  'twin already matched',
  [row('L1', '2026-06-20', 'Coffee Shop', 4.5)],
  [row('M1', '2026-06-18', 'COFFEE SHOP', 4.5)],
);

// Same shape but dated outside the duplicate window -> not a duplicate.
add(
  'twin too far away',
  [row('L1', '2026-06-20', 'Coffee Shop', 4.5)],
  [row('M1', '2026-05-01', 'COFFEE SHOP', 4.5)],
);

// Two identical leftovers -> the second is a duplicate by repetition.
add(
  'repeated identity',
  [row('L1', '2026-06-20', 'Gym', 39.99), row('L2', '2026-06-20', 'Gym', 39.99)],
  [row('M1', '2026-06-01', 'Something Else', 10)],
);

// Near the end date -> pending, not phantom.
add(
  'within the grace window',
  [row('L1', '2026-06-28', 'Hardware Store', 82.14)],
  [row('M1', '2026-06-01', 'Other', 5)],
);

// Old and unmatched -> phantom.
add(
  'too old to be pending',
  [row('L1', '2026-05-02', 'Hardware Store', 82.14)],
  [row('M1', '2026-06-01', 'Other', 5)],
);

// Gross vs amount: same net, different purchase -> NOT the same thing.
add(
  'same net, different gross',
  [row('L1', '2026-06-20', 'Store', 20, 25)],
  [row('M1', '2026-06-19', 'Store', 20, 30)],
);

// A run of five twinned rows -> claimed as a re-entered period.
{
  const lefts = [],
    matches = [];
  for (let i = 0; i < 5; i++) {
    lefts.push(row(`L${i}`, `2026-06-1${i}`, `Vendor ${i}`, 10 + i));
    matches.push(row(`M${i}`, `2026-05-1${i}`, `Vendor ${i}`, 10 + i));
  }
  add('a run of five re-entered rows', lefts, matches);
}

// Four twinned rows -> below minRows, no run claimed.
{
  const lefts = [],
    matches = [];
  for (let i = 0; i < 4; i++) {
    lefts.push(row(`L${i}`, `2026-06-1${i}`, `Vendor ${i}`, 10 + i));
    matches.push(row(`M${i}`, `2026-05-1${i}`, `Vendor ${i}`, 10 + i));
  }
  add('four twinned rows is below the threshold', lefts, matches);
}

// Two separate re-entered months -> two runs, split by the span cap.
{
  const lefts = [],
    matches = [];
  for (let i = 0; i < 5; i++) {
    lefts.push(row(`A${i}`, `2026-06-1${i}`, `V${i}`, 10 + i));
    matches.push(row(`AM${i}`, `2026-01-1${i}`, `V${i}`, 10 + i));
  }
  for (let i = 0; i < 5; i++) {
    lefts.push(row(`B${i}`, `2026-06-2${i}`, `W${i}`, 20 + i));
    matches.push(row(`BM${i}`, `2026-05-1${i}`, `W${i}`, 20 + i));
  }
  add('two separate re-entered periods', lefts, matches);
}

// A run outranks the pending window.
{
  const lefts = [],
    matches = [];
  for (let i = 0; i < 5; i++) {
    lefts.push(row(`L${i}`, '2026-06-29', `Vendor ${i}`, 10 + i)); // all inside grace
    matches.push(row(`M${i}`, `2026-05-1${i}`, `Vendor ${i}`, 10 + i));
  }
  add('a run beats the pending window', lefts, matches);
}

// Multiple matched twins at different distances -> the NEAREST is kept.
//
// This is the only shape where the nearest-twin rule is observable: with a
// month entered twice the same merchant and amount recur, and pairing against
// an arbitrary twin reports a span wider than the mistake actually was. Added
// after a mutation test showed the original fixture could not tell "nearest"
// from "first".
{
  const lefts = [],
    matches = [];
  for (let i = 0; i < 5; i++) {
    lefts.push(row(`L${i}`, `2026-06-1${i}`, `Vendor ${i}`, 10 + i));
    // A FAR twin first, then a NEAR one. Keeping the first would stretch the
    // run's span back to January.
    matches.push(row(`FAR${i}`, `2026-01-0${i + 1}`, `Vendor ${i}`, 10 + i));
    matches.push(row(`NEAR${i}`, `2026-05-2${i}`, `Vendor ${i}`, 10 + i));
  }
  add('nearest twin wins over the first one seen', lefts, matches);
}

// No matched rows at all -> nothing can be a duplicate.
add('no matched rows', [row('L1', '2026-06-20', 'Gym', 39.99)], []);

process.stdout.write(
  JSON.stringify({ generatedBy: 'packages/core/dist', count: cases.length, cases }, null, 1),
);
