/**
 * Differential fixture for merchant-name similarity.
 *
 * The descriptors below are SYNTHETIC. Real ones were available — 323 of them
 * in the production `TransactionDescription` table — and were deliberately not
 * used: a merchant list is personal financial data (subscriptions, medical
 * providers, habits) and does not belong in a repository. What the test needs
 * is the SHAPE of a bank descriptor, not anyone's actual spending.
 *
 * The shapes below are drawn from what real descriptors do to a merchant name:
 * card-processor prefixes, store and reference numbers, truncation, legal
 * entities, and the noise words `normalizeName` strips.
 *
 *   node rust/core/tests/fixtures/generate-names.mjs > name_vectors.json
 */
import { normalizeName, nameSimilarity, dayDiff } from '../../../../packages/core/dist/index.js';

const NAMES = [
  // plain
  'Amazon',
  'Costco',
  'Whole Foods',
  'Netflix',
  'Spotify',
  // with the noise words normalizeName strips
  'POS PURCHASE AMAZON',
  'DEBIT CARD PURCHASE COSTCO',
  'RECURRING PAYMENT NETFLIX',
  'CARD PURCHASE XXXX1234 SPOTIFY',
  // store / reference numbers
  'COSTCO WHSE #0429',
  'WALMART 3421 SUPERCENTER',
  'SHELL OIL 57445123456',
  'TST* ROSSIS CAFE 002',
  'SQ *COFFEE SHOP 12',
  // truncation and prefixes
  'WHOLE FOODS MKT',
  'WHOLEFDS',
  'AMZN Mktp US*2A4B5',
  'AMAZON.COM*RT4G9',
  // legal entities and punctuation
  "Rossi's Italian Cafe",
  'ACME CORP., LLC',
  'A&W Restaurant',
  // trade descriptors — the case that motivated tradeAmountTolerance
  'Purchase of Acme Variable Rate Perpetual Stretch Preferred Stock',
  'Buy TCKC',
  'SELL 12 SHARES VTSAX',
  'Sell VTSAX',
  // degenerate
  '',
  '   ',
  '123456',
  '###',
  'a',
];

const pairs = [];
for (const a of NAMES) for (const b of NAMES) pairs.push({ a, b, sim: nameSimilarity(a, b) });

const normalized = NAMES.map((n) => ({ in: n, out: normalizeName(n) }));

const DATES = [
  '2026-01-01',
  '2026-01-02',
  '2026-01-31',
  '2026-02-01',
  '2026-03-01',
  '2025-12-31',
  '2024-02-29',
];
const dayDiffs = [];
for (const a of DATES) for (const b of DATES) dayDiffs.push({ a, b, days: dayDiff(a, b) });

process.stdout.write(
  JSON.stringify(
    { generatedBy: 'packages/core/dist', synthetic: true, normalized, pairs, dayDiffs },
    null,
    1,
  ),
);
