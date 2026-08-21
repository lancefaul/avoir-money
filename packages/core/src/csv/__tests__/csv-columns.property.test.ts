// Feature: import-export-enhancement, Property 3: Auto-mapping detects canonical columns
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { CSV_COLUMNS, CSVColumnName, COLUMN_PATTERNS, autoMapColumns } from '../csv-columns.js';

/** Build a set of all known patterns (lowercased) across all columns */
function allPatternsSet(): Set<string> {
  const s = new Set<string>();
  for (const col of CSV_COLUMNS) {
    for (const p of COLUMN_PATTERNS[col]) {
      s.add(p.toLowerCase());
    }
  }
  return s;
}

const ALL_PATTERNS = allPatternsSet();

/**
 * Generates a header string that does NOT match any column pattern
 * (neither exact nor as a substring).
 * Uses a prefix that no pattern starts with to avoid accidental substring matches.
 */
const nonMatchingHeaderArb = fc.stringMatching(/^zzq_[a-z]{3,8}$/).filter((s) => {
  const lower = s.toLowerCase();
  for (const p of ALL_PATTERNS) {
    if (lower === p || lower.includes(p)) return false;
  }
  return true;
});

/**
 * Arbitrary: pick a non-empty subset of canonical column names.
 */
const canonicalSubsetArb = fc.subarray([...CSV_COLUMNS], { minLength: 1 }).map((arr) => [...arr]);

describe('Feature: import-export-enhancement, Property 3: Auto-mapping detects canonical columns', () => {
  /**
   * **Validates: Requirements 11.1, 11.2, 11.3, 11.4**
   *
   * For any subset of canonical column names mixed with non-matching headers,
   * autoMapColumns maps each canonical header to the correct CSVColumnName
   * and does not produce false positive mappings for non-matching headers.
   */

  it('maps every canonical column header to its correct CSVColumnName', () => {
    fc.assert(
      fc.property(
        canonicalSubsetArb,
        fc.array(nonMatchingHeaderArb, { minLength: 0, maxLength: 5 }),
        (canonicalHeaders, extraHeaders) => {
          // Shuffle canonical + extra headers together
          const headers = [...canonicalHeaders, ...extraHeaders];

          const mapping = autoMapColumns(headers);

          // Every canonical header in the input should be mapped to the correct column
          for (const header of canonicalHeaders) {
            const col = header as CSVColumnName;
            expect(mapping[col]).toBe(header);
          }
        },
      ),
      { numRuns: 20 },
    );
  });

  it('does not produce false positive mappings for non-matching headers', () => {
    fc.assert(
      fc.property(fc.array(nonMatchingHeaderArb, { minLength: 1, maxLength: 10 }), (headers) => {
        const mapping = autoMapColumns(headers);

        // With only non-matching headers, the mapping should be empty
        expect(Object.keys(mapping).length).toBe(0);
      }),
      { numRuns: 20 },
    );
  });

  it('maps canonical headers correctly even when mixed with non-matching headers in any order', () => {
    fc.assert(
      fc.property(
        canonicalSubsetArb,
        fc.array(nonMatchingHeaderArb, { minLength: 1, maxLength: 5 }),
        fc.boolean(),
        (canonicalHeaders, extraHeaders, extraFirst) => {
          // Place extra headers before or after canonical ones
          const headers = extraFirst
            ? [...extraHeaders, ...canonicalHeaders]
            : [...canonicalHeaders, ...extraHeaders];

          const mapping = autoMapColumns(headers);

          // All canonical headers should still be correctly mapped
          for (const header of canonicalHeaders) {
            const col = header as CSVColumnName;
            expect(mapping[col]).toBe(header);
          }

          // The mapping values should only contain headers from our input
          const mappedValues = new Set(Object.values(mapping));
          for (const val of mappedValues) {
            expect(headers).toContain(val);
          }

          // No non-matching header should appear as a mapped value
          for (const extra of extraHeaders) {
            expect(mappedValues.has(extra)).toBe(false);
          }
        },
      ),
      { numRuns: 20 },
    );
  });

  it('maps pattern aliases to the correct column (case-insensitive)', () => {
    // For each column, pick a random alias pattern and verify it maps correctly
    const columnWithAliasArb = fc.constantFrom(...CSV_COLUMNS).chain((col) => {
      const patterns = COLUMN_PATTERNS[col];
      return fc.constantFrom(...patterns).map((pattern) => ({ col, pattern }));
    });

    fc.assert(
      fc.property(
        fc.array(columnWithAliasArb, { minLength: 1, maxLength: 10 }),
        fc.constantFrom('lower', 'upper', 'mixed') as fc.Arbitrary<'lower' | 'upper' | 'mixed'>,
        (entries, caseStyle) => {
          // Deduplicate by column to avoid conflicts
          const seen = new Set<string>();
          const unique = entries.filter((e) => {
            if (seen.has(e.col)) return false;
            seen.add(e.col);
            return true;
          });

          const headers = unique.map((e) => {
            switch (caseStyle) {
              case 'upper':
                return e.pattern.toUpperCase();
              case 'mixed':
                return e.pattern.charAt(0).toUpperCase() + e.pattern.slice(1);
              default:
                return e.pattern;
            }
          });

          const mapping = autoMapColumns(headers);

          for (let i = 0; i < unique.length; i++) {
            const col = unique[i].col as CSVColumnName;
            // The column should be mapped (to the header we provided)
            expect(mapping[col]).toBe(headers[i]);
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});
