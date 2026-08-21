/**
 * Differential fixture for CSV sign normalization.
 *
 * Unlike the other two fixtures this one is EXHAUSTIVE, not sampled: the input
 * space is every config combination (6 expense × 4 income × 2 transfer ×
 * 2 trade = 96) crossed with all five transaction types and a set of boundary
 * amounts. That is small enough to enumerate completely, so "the Rust matches
 * the TypeScript" is a total statement here rather than a statistical one.
 *
 *   node rust/core/tests/fixtures/generate-signs.mjs > sign_vectors.json
 */

import { normalizeAmount } from '../../../../packages/core/dist/index.js';

const POS_EXPENSE = ['money_out', 'money_in'];
const NEG_EXPENSE = ['refund', 'ignore', 'spending'];
const POS_INCOME = ['money_in', 'money_out'];
const NEG_INCOME = ['flip_sign', 'ignore'];
const POS_TRANSFER = ['withdrawal', 'deposit'];
const POS_TRADE = ['buy', 'sell'];

const TYPES = ['EXPENSE', 'INCOME', 'TRANSFER', 'TRADE', 'REFUND'];

// Amounts in CENTS — the representation the Rust side uses. Boundaries first:
// zero (always excluded), one cent either side, then ordinary magnitudes.
const AMOUNTS_CENTS = [0, 1, -1, 100, -100, 234_75, -234_75, 2_347_555, -2_347_555];

const vectors = [];

for (const pe of POS_EXPENSE) {
  for (const ne of NEG_EXPENSE) {
    for (const pi of POS_INCOME) {
      for (const ni of NEG_INCOME) {
        for (const pt of POS_TRANSFER) {
          for (const ptr of POS_TRADE) {
            const config = {
              expense: { positiveMeaning: pe, negativeMeaning: ne },
              income: { positiveMeaning: pi, negativeMeaning: ni },
              transfer: { positiveMeaning: pt },
              trade: { positiveMeaning: ptr },
              refund: { positiveMeaning: 'money_in' },
            };
            for (const type of TYPES) {
              for (const cents of AMOUNTS_CENTS) {
                const r = normalizeAmount(cents / 100, type, config);
                vectors.push({
                  in: { cents, type, config },
                  out: 'excluded' in r ? { excluded: true } : { cents: Math.round(r.amount * 100) },
                });
              }
            }
          }
        }
      }
    }
  }
}

process.stdout.write(
  JSON.stringify(
    {
      generatedBy: 'packages/core/dist',
      exhaustive: true,
      count: vectors.length,
      vectors,
    },
    null,
    1,
  ),
);
