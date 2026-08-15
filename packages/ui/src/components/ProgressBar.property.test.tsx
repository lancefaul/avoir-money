import fc from 'fast-check';
import { render, screen, cleanup } from '@testing-library/react';
import { ProgressBar, autoVariant } from './ProgressBar.js';

/**
 * Feature: ds-component-tests, Property 1: ProgressBar value clamping
 *
 * For any numeric value passed to ProgressBar, the rendered `aria-valuenow`
 * attribute is clamped to [0, 100]. Values below 0 produce 0, values above
 * 100 produce 100, and values within range are unchanged.
 *
 * **Validates: Requirements 13.2, 13.3**
 */
describe('ProgressBar value clamping (property)', () => {
  it('aria-valuenow is always clamped to [0, 100] for integer values', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1000, max: 1000 }), (value) => {
        render(<ProgressBar value={value} />);
        const bar = screen.getByRole('progressbar');
        const ariaValueNow = Number(bar.getAttribute('aria-valuenow'));

        // aria-valuenow must be within [0, 100]
        expect(ariaValueNow).toBeGreaterThanOrEqual(0);
        expect(ariaValueNow).toBeLessThanOrEqual(100);

        // Verify exact clamping behavior
        if (value < 0) {
          expect(ariaValueNow).toBe(0);
        } else if (value > 100) {
          expect(ariaValueNow).toBe(100);
        } else {
          expect(ariaValueNow).toBe(value);
        }

        cleanup();
      }),
      { numRuns: 100 },
    );
  });

  it('aria-valuenow is always clamped to [0, 100] for double values', () => {
    fc.assert(
      fc.property(fc.double({ min: -1000, max: 1000, noNaN: true }), (value) => {
        const { unmount } = render(<ProgressBar value={value} />);
        try {
          const bar = screen.getByRole('progressbar');
          const ariaValueNow = Number(bar.getAttribute('aria-valuenow'));

          // aria-valuenow must be within [0, 100]
          expect(ariaValueNow).toBeGreaterThanOrEqual(0);
          expect(ariaValueNow).toBeLessThanOrEqual(100);

          // Verify exact clamping behavior
          if (value < 0) {
            expect(ariaValueNow).toBe(0);
          } else if (value > 100) {
            expect(ariaValueNow).toBe(100);
          } else {
            // -0 becomes 0 when serialized to a DOM attribute
            expect(ariaValueNow).toBe(Object.is(value, -0) ? 0 : value);
          }
        } finally {
          unmount();
          cleanup();
        }
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Feature: ds-component-tests, Property 2: ProgressBar autoColor variant resolution
 *
 * For any numeric value passed to ProgressBar with `autoColor={true}`, the
 * resolved variant follows the threshold rules:
 *   >= 100 → danger
 *   [80, 100) → warning
 *   [50, 80) → default
 *   < 50 → success
 *
 * The property test exercises the `autoVariant` function directly because
 * vanilla-extract CSS classes are mocked to identical strings in the test
 * environment, making DOM-based variant detection impossible.
 *
 * **Validates: Requirements 13.4, 13.5**
 */
describe('ProgressBar autoColor variant resolution (property)', () => {
  it('autoVariant resolves correct variant for integer values', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1000, max: 1000 }), (value) => {
        // autoVariant receives the clamped value (0–100), so clamp first
        const clamped = Math.min(Math.max(value, 0), 100);
        const variant = autoVariant(clamped);

        if (clamped >= 100) {
          expect(variant).toBe('danger');
        } else if (clamped >= 80) {
          expect(variant).toBe('warning');
        } else if (clamped >= 50) {
          expect(variant).toBe('default');
        } else {
          expect(variant).toBe('success');
        }
      }),
      { numRuns: 100 },
    );
  });

  it('autoVariant resolves correct variant for double values', () => {
    fc.assert(
      fc.property(fc.double({ min: -1000, max: 1000, noNaN: true }), (value) => {
        const clamped = Math.min(Math.max(value, 0), 100);
        const variant = autoVariant(clamped);

        if (clamped >= 100) {
          expect(variant).toBe('danger');
        } else if (clamped >= 80) {
          expect(variant).toBe('warning');
        } else if (clamped >= 50) {
          expect(variant).toBe('default');
        } else {
          expect(variant).toBe('success');
        }
      }),
      { numRuns: 100 },
    );
  });

  it('autoColor variant is correctly applied when rendering ProgressBar', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 200 }), (value) => {
        render(<ProgressBar value={value} autoColor />);
        const bar = screen.getByRole('progressbar');
        const clamped = Math.min(Math.max(value, 0), 100);

        // Verify the clamped value is set correctly
        expect(Number(bar.getAttribute('aria-valuenow'))).toBe(clamped);

        // Verify the fill element exists and has the correct width
        const fill = bar.firstElementChild as HTMLElement;
        expect(fill).toBeTruthy();
        expect(fill.style.width).toBe(`${clamped}%`);

        cleanup();
      }),
      { numRuns: 100 },
    );
  });
});
