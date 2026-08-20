import { describe, it, expect } from 'vitest';
import { computeLineTotal } from './child-transaction.js';

describe('computeLineTotal – unit tests', () => {
  /**
   * Validates: Requirements 1.2, 1.3, 5.4
   */

  it('$100 at 8.25% tax rate → tax $8.25, total $108.25', () => {
    const result = computeLineTotal({ preTaxAmount: 100, taxRate: 8.25 });

    expect(result.preTaxAmount).toBe(100);
    expect(result.taxAmount).toBe(8.25);
    expect(result.lineTotal).toBe(108.25);
  });

  it('$33.33 at 7% tax rate → tax $2.33 (rounded), total $35.66', () => {
    const result = computeLineTotal({ preTaxAmount: 33.33, taxRate: 7 });

    expect(result.taxAmount).toBe(2.33);
    expect(result.lineTotal).toBe(35.66);
  });

  it('zero taxAmount → lineTotal equals preTaxAmount', () => {
    const result = computeLineTotal({ preTaxAmount: 50, taxAmount: 0 });

    expect(result.taxAmount).toBe(0);
    expect(result.lineTotal).toBe(50);
  });

  it('no tax provided → lineTotal equals preTaxAmount, taxAmount = 0', () => {
    const result = computeLineTotal({ preTaxAmount: 75.5 });

    expect(result.taxAmount).toBe(0);
    expect(result.lineTotal).toBe(75.5);
  });
});
