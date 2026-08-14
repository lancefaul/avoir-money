/**
 * Property-Based Tests for inferServiceType
 *
 * Feature: utility-providers, Property 9: Type name to ServiceType mapping
 * Validates: Requirements 5.5
 *
 * Tests that the type inference function correctly maps known utility type name
 * patterns to their ServiceType and defaults to ELECTRIC for unknown strings.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { inferServiceType, type ServiceType } from './utility-inference.js';

/** All valid ServiceType values. */
const ALL_SERVICE_TYPES: ServiceType[] = [
  'ELECTRIC',
  'GAS',
  'WATER',
  'GARBAGE',
  'SEWAGE',
  'INTERNET',
  'CELLULAR',
];

/**
 * Map of ServiceType → keywords that should trigger that type.
 * Each keyword is a case-insensitive substring match.
 */
const KEYWORD_MAP: Record<ServiceType, string[]> = {
  ELECTRIC: ['electric'],
  GAS: ['gas'],
  WATER: ['water'],
  GARBAGE: ['garbage', 'trash', 'waste'],
  SEWAGE: ['sewage', 'sewer'],
  INTERNET: ['internet', 'wifi', 'broadband'],
  CELLULAR: ['cellular', 'cell', 'mobile', 'phone'],
};

/**
 * All keywords that trigger a known ServiceType.
 * Used to build "unknown" strings that avoid accidental matches.
 */
const ALL_KEYWORDS = Object.values(KEYWORD_MAP).flat();

/**
 * Priority order of ServiceType checks in inferServiceType.
 * Earlier entries take precedence when multiple keywords match.
 */
const PRIORITY_ORDER: ServiceType[] = [
  'ELECTRIC',
  'GAS',
  'WATER',
  'GARBAGE',
  'SEWAGE',
  'INTERNET',
  'CELLULAR',
];

/**
 * For a given ServiceType, returns all keywords from higher-priority types
 * that would shadow this type's match if present in the string.
 */
function higherPriorityKeywords(serviceType: ServiceType): string[] {
  const idx = PRIORITY_ORDER.indexOf(serviceType);
  return PRIORITY_ORDER.slice(0, idx).flatMap((st) => KEYWORD_MAP[st]);
}

/**
 * Generator for a string containing a known keyword, optionally surrounded
 * by random prefix/suffix text and with random casing.
 * Filters out cases where the full string accidentally matches a higher-priority keyword.
 */
function knownPatternArb(
  serviceType: ServiceType,
): fc.Arbitrary<{ input: string; expected: ServiceType }> {
  const keywords = KEYWORD_MAP[serviceType];
  const forbidden = higherPriorityKeywords(serviceType);
  return fc
    .tuple(
      fc.constantFrom(...keywords),
      fc.string({ minLength: 0, maxLength: 20 }),
      fc.string({ minLength: 0, maxLength: 20 }),
      fc.boolean(),
    )
    .filter(([keyword, prefix, suffix]) => {
      // Check the full assembled string for higher-priority keyword matches
      const full = (prefix + keyword + suffix).toLowerCase();
      return !forbidden.some((kw) => full.includes(kw));
    })
    .map(([keyword, prefix, suffix, upper]) => {
      const cased = upper ? keyword.toUpperCase() : keyword;
      return { input: `${prefix}${cased}${suffix}`, expected: serviceType };
    });
}

/**
 * Generator for strings that do NOT contain any known keyword.
 * Filters out accidental matches against all known patterns.
 */
const unknownStringArb = fc.string({ minLength: 0, maxLength: 50 }).filter((s) => {
  const lower = s.toLowerCase();
  return !ALL_KEYWORDS.some((kw) => lower.includes(kw));
});

describe('Feature: utility-providers, Property 9: Type name to ServiceType mapping', () => {
  /**
   * Validates: Requirements 5.5
   *
   * For any string containing a known keyword (case-insensitive),
   * inferServiceType returns the correct ServiceType.
   */
  it('returns the correct ServiceType for strings containing known keywords', () => {
    // Build a generator that picks a random ServiceType and generates a matching string
    const knownInputArb = fc.oneof(...ALL_SERVICE_TYPES.map((st) => knownPatternArb(st)));

    fc.assert(
      fc.property(knownInputArb, ({ input, expected }) => {
        const result = inferServiceType(input);
        expect(result).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Validates: Requirements 5.5
   *
   * For any string that does NOT match any known pattern,
   * inferServiceType returns ELECTRIC as the default.
   */
  it('returns ELECTRIC as default for unknown strings', () => {
    fc.assert(
      fc.property(unknownStringArb, (input) => {
        const result = inferServiceType(input);
        expect(result).toBe('ELECTRIC');
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Validates: Requirements 5.5
   *
   * The return value is always a valid ServiceType enum member.
   */
  it('always returns a valid ServiceType value', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 100 }), (input) => {
        const result = inferServiceType(input);
        expect(ALL_SERVICE_TYPES).toContain(result);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Validates: Requirements 5.5
   *
   * The function is case-insensitive: the same keyword in any casing
   * produces the same result.
   */
  it('is case-insensitive — same keyword in different casings yields same result', () => {
    const keywordArb = fc.constantFrom(...ALL_KEYWORDS);

    fc.assert(
      fc.property(keywordArb, (keyword) => {
        const lower = inferServiceType(keyword.toLowerCase());
        const upper = inferServiceType(keyword.toUpperCase());
        const mixed = inferServiceType(
          keyword
            .split('')
            .map((c, i) => (i % 2 === 0 ? c.toUpperCase() : c.toLowerCase()))
            .join(''),
        );
        expect(lower).toBe(upper);
        expect(lower).toBe(mixed);
      }),
      { numRuns: 100 },
    );
  });
});
