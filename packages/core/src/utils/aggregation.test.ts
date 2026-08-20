import { describe, it, expect } from 'vitest';
import { groupBy, sumBy, groupAndSum, sortedTotals, percentage } from './aggregation.js';

describe('groupBy', () => {
  it('groups items by key', () => {
    const items = [
      { cat: 'A', v: 1 },
      { cat: 'B', v: 2 },
      { cat: 'A', v: 3 },
    ];
    const result = groupBy(items, (i) => i.cat);
    expect(result.get('A')).toHaveLength(2);
    expect(result.get('B')).toHaveLength(1);
  });
  it('returns empty map for empty array', () => {
    expect(groupBy([], () => 'x').size).toBe(0);
  });
});

describe('sumBy', () => {
  it('sums values', () => {
    expect(sumBy([{ v: 10 }, { v: 20 }, { v: 30 }], (i) => i.v)).toBe(60);
  });
  it('returns 0 for empty', () => {
    expect(sumBy([], () => 0)).toBe(0);
  });
});

describe('groupAndSum', () => {
  it('groups and sums', () => {
    const items = [
      { cat: 'A', v: 10 },
      { cat: 'B', v: 20 },
      { cat: 'A', v: 30 },
    ];
    const result = groupAndSum(
      items,
      (i) => i.cat,
      (i) => i.v,
    );
    expect(result.get('A')).toBe(40);
    expect(result.get('B')).toBe(20);
  });
});

describe('sortedTotals', () => {
  it('sorts descending by total', () => {
    const map = new Map([
      ['A', 10],
      ['B', 30],
      ['C', 20],
    ]);
    const result = sortedTotals(map);
    expect(result[0]!.key).toBe('B');
    expect(result[1]!.key).toBe('C');
    expect(result[2]!.key).toBe('A');
  });
});

describe('percentage', () => {
  it('calculates percentage', () => {
    expect(percentage(25, 100)).toBe(25);
  });
  it('returns 0 when whole is 0', () => {
    expect(percentage(10, 0)).toBe(0);
  });
  it('rounds to one decimal', () => {
    expect(percentage(1, 3)).toBeCloseTo(33.3, 1);
  });
});
