/**
 * Attack payload library — shared adversarial input arrays and fast-check arbitraries
 * for security tests.
 */
import * as fc from 'fast-check';

// ─── Static Payload Arrays ──────────────────────────────────────────────────

/** Classic SQL injection strings targeting PostgreSQL / generic SQL. */
export const SQL_INJECTION_PAYLOADS: string[] = [
  '\'; DROP TABLE "Transaction"; --',
  "' OR '1'='1",
  "'; SELECT pg_sleep(5); --",
  '1; DROP TABLE users --',
  "' UNION SELECT NULL, NULL, NULL --",
  '\'; TRUNCATE TABLE "Account"; --',
  "' OR 1=1; --",
  "'; INSERT INTO \"Transaction\" (id) VALUES ('hacked'); --",
];

/** Unicode-variant SQL injection payloads (fullwidth apostrophes, null bytes). */
export const UNICODE_SQL_PAYLOADS: string[] = [
  // Fullwidth apostrophe U+FF07
  '\uFF07 OR \uFF071\uFF07=\uFF071',
  // Unicode null byte
  'test\u0000; DROP TABLE "Account"; --',
  // Right single quotation mark U+2019
  '\u2019 OR \u20191\u2019=\u20191',
  // Fullwidth semicolon U+FF1B
  '\uFF1B DROP TABLE "Transaction"\uFF1B --',
];

/** HTML/script injection strings for XSS testing. */
export const XSS_PAYLOADS: string[] = [
  "<script>alert('xss')</script>",
  '<img onerror=alert(1) src=x>',
  'javascript:alert(1)',
  '<svg onload=alert(1)>',
  '"><script>alert(document.cookie)</script>',
  "<iframe src='javascript:alert(1)'>",
];

/** Entity-encoded XSS attempts. */
export const HTML_ENTITY_PAYLOADS: string[] = [
  '&#60;script&#62;alert(1)&#60;/script&#62;',
  '&lt;script&gt;alert(1)&lt;/script&gt;',
  '&#x3C;script&#x3E;alert(1)&#x3C;/script&#x3E;',
];

// ─── fast-check Arbitraries ─────────────────────────────────────────────────

/** SQL metacharacters used to build random adversarial strings. */
const SQL_METACHARS = ["'", '"', ';', '--', '/**/', '`', '%', '_'];

/**
 * Arbitrary generating random strings interspersed with SQL metacharacters.
 * Produces strings like: foo'; bar--baz/\*\*\/qux
 */
export const sqlMetacharArb: fc.Arbitrary<string> = fc
  .array(fc.oneof(fc.string({ minLength: 0, maxLength: 10 }), fc.constantFrom(...SQL_METACHARS)), {
    minLength: 1,
    maxLength: 8,
  })
  .map((parts) => parts.join(''));

/**
 * Arbitrary generating random invalid JSON strings.
 * Produces strings that are NOT valid JSON (truncated objects, bad syntax, etc.).
 */
export const malformedJsonArb: fc.Arbitrary<string> = fc.oneof(
  // Truncated object
  fc.string({ minLength: 1, maxLength: 20 }).map((s) => '{' + s),
  // Missing closing bracket
  fc.string({ minLength: 1, maxLength: 20 }).map((s) => '[' + s),
  // Bare word (not a valid JSON value)
  fc.string({ minLength: 1, maxLength: 15 }).filter((s: string) => {
    try {
      JSON.parse(s);
      return false;
    } catch {
      return true;
    }
  }),
  // Trailing comma
  fc.constant('{"a": 1,}'),
  // Single quotes instead of double
  fc.constant("{'key': 'value'}"),
);

/**
 * Arbitrary generating random JSON-like structures (objects with random keys,
 * values of random types including strings, numbers, booleans, nulls,
 * nested objects, and arrays).
 */
export const randomPayloadArb: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  value: fc.oneof(
    { depthSize: 'small' },
    fc.string({ minLength: 0, maxLength: 50 }),
    fc.double({ min: -1e6, max: 1e6, noNaN: true }),
    fc.boolean(),
    fc.constant(null),
    tie('object'),
    tie('array'),
  ),
  object: fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), tie('value'), {
    minKeys: 0,
    maxKeys: 5,
  }),
  array: fc.array(tie('value'), { minLength: 0, maxLength: 5 }),
})).value;
