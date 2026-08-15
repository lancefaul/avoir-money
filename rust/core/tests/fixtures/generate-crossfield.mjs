/**
 * Differential fixture for `transactionCrossFieldIssues` — EXHAUSTIVE.
 *
 * The input is a type plus four booleans: 5 x 2^4 = 80 combinations, so the
 * whole space is enumerated. Agreement with the TypeScript is total here.
 *
 *   node rust/core/tests/fixtures/generate-crossfield.mjs > crossfield_vectors.json
 */
import { transactionCrossFieldIssues } from '../../../../packages/core/dist/index.js';

const TYPES = ['EXPENSE', 'INCOME', 'TRANSFER', 'REFUND', 'TRADE'];
const vectors = [];
for (const type of TYPES)
  for (const hasFundingAccount of [false, true])
    for (const hasTradeMetadata of [false, true])
      for (const hasBitcoinMetadata of [false, true])
        for (const isCashBack of [false, true]) {
          const facts = {
            type,
            hasFundingAccount,
            hasTradeMetadata,
            hasBitcoinMetadata,
            isCashBack,
          };
          vectors.push({ in: facts, out: transactionCrossFieldIssues(facts) });
        }

const withIssues = vectors.filter((v) => v.out.length > 0).length;
process.stdout.write(
  JSON.stringify(
    {
      generatedBy: 'packages/core/dist',
      exhaustive: true,
      count: vectors.length,
      withIssues,
      vectors,
    },
    null,
    1,
  ),
);
