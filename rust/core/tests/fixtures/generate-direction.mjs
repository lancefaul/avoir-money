/**
 * Differential fixture for `appTxDirection` — EXHAUSTIVE.
 *
 * 5 types x inbound x {BUY, SELL, null} = 30 combinations, all enumerated.
 * This function is used by BOTH the API and the web, so the two sides agreeing
 * on it is load-bearing: disagreement means a statement line and its app row
 * differ on which way the money went.
 *
 *   node rust/core/tests/fixtures/generate-direction.mjs > direction_vectors.json
 */
import { appTxDirection } from '../../../../packages/core/dist/index.js';

const vectors = [];
for (const type of ['EXPENSE', 'INCOME', 'TRANSFER', 'REFUND', 'TRADE'])
  for (const inbound of [false, true])
    for (const tradeDirection of [null, 'BUY', 'SELL']) {
      const tx = { type, inbound, tradeDirection };
      vectors.push({ in: tx, out: appTxDirection(tx) });
    }

process.stdout.write(
  JSON.stringify(
    { generatedBy: 'packages/core/dist', exhaustive: true, count: vectors.length, vectors },
    null,
    1,
  ),
);
