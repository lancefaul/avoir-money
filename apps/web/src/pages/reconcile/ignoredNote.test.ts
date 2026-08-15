/**
 * A judgement should outlive the sitting that produced it.
 *
 * A session is scaffolding for one reconciliation — abandon it and any "I have
 * looked at this and it is fine" goes with it, so the same row is flagged again
 * next month and re-examined from scratch. Appending to the transaction's own
 * note is what makes the decision durable.
 */
import { describe, it, expect } from 'vitest';
import {
  appendIgnoredNote,
  ignoreActionFor,
  isDurablyIgnored,
  IGNORED_NOTE_PREFIX,
} from './types.js';
import type { ResolutionItem } from './types.js';

describe('appendIgnoredNote', () => {
  it('marks a transaction that had no note', () => {
    const out = appendIgnoredNote(null, '2026-07-19');
    expect(out).toContain(IGNORED_NOTE_PREFIX);
    expect(out).toContain('2026-07-19');
  });

  it('keeps whatever the note already said', () => {
    // Overwriting would destroy the user's own words to record ours.
    const out = appendIgnoredNote('Split with Dana', '2026-07-19');
    expect(out.startsWith('Split with Dana')).toBe(true);
    expect(out).toContain(IGNORED_NOTE_PREFIX);
  });

  it('treats an empty or whitespace note as absent', () => {
    expect(appendIgnoredNote('', '2026-07-19').startsWith(IGNORED_NOTE_PREFIX)).toBe(true);
    expect(appendIgnoredNote('   ', '2026-07-19').startsWith(IGNORED_NOTE_PREFIX)).toBe(true);
  });

  it('leaves a greppable marker rather than free prose', () => {
    // A later reconciliation finds previously-dismissed rows by searching for
    // the prefix, which only works if it is fixed.
    const a = appendIgnoredNote(null, '2026-07-19');
    const b = appendIgnoredNote('Anything', '2026-08-20');
    expect(a.includes(IGNORED_NOTE_PREFIX) && b.includes(IGNORED_NOTE_PREFIX)).toBe(true);
  });

  it('accumulates across reconciliations without losing the earlier one', () => {
    const first = appendIgnoredNote(null, '2026-07-19');
    const second = appendIgnoredNote(first, '2026-08-20');
    expect(second).toContain('2026-07-19');
    expect(second).toContain('2026-08-20');
  });
});

/**
 * How long a dismissal is allowed to last.
 *
 * Not every "leave it" is the same claim. "This was recorded, it is months old,
 * and the bank never posted it" is a verdict about history and history does not
 * move. "This has not posted yet" is a statement about timing — it posts NEXT
 * period, and often not for the amount the app holds, because a restaurant tab
 * settles with the tip added and a hand-entered figure is only as good as the
 * typing. Marking that one permanently would hide the very statement line that
 * proves the app wrong, and the gap would sit in the residual unexplained.
 */
describe('how long an ignore lasts', () => {
  const item = (apps: { id: string; note?: string | null }[]): ResolutionItem => ({
    key: 'k',
    statements: [],
    apps: apps.map((a) => ({ ...a, date: '2026-06-01', name: a.id, amount: 5 })),
    delta: 0,
  });

  it('carries every app row in the decision, not just the first', () => {
    // The reported bug: four transactions summing to one statement line, one
    // of them marked, so the group came back whole on the next match as though
    // nothing had been decided.
    const action = ignoreActionFor(
      item([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]),
      'combination',
    );
    expect(action.kind === 'ignore' && action.transactions?.map((t) => t.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('writes nothing durable for a row that has not posted yet', () => {
    const action = ignoreActionFor(item([{ id: 'a' }]), 'pending_in_app');
    expect(action.kind === 'ignore' && action.transactions).toBeUndefined();
  });

  it('writes nothing durable for an amount that disagrees with the bank', () => {
    // A live arithmetic fact, not a question a past dismissal may answer. If
    // the delta changes it is a new question.
    const action = ignoreActionFor(item([{ id: 'a' }]), 'amount_differs');
    expect(action.kind === 'ignore' && action.transactions).toBeUndefined();
  });

  const marked = { id: 'a', note: appendIgnoredNote(null, '2026-06-01') };

  it('honours the marker only where the verdict cannot change', () => {
    expect(isDurablyIgnored(item([marked]), 'in_app_not_on_statement')).toBe(true);
    expect(isDurablyIgnored(item([marked]), 'combination')).toBe(true);
  });

  it('ignores the marker on a pending row or a disagreeing amount', () => {
    // Both of these ask again next period, on purpose. A tip added at
    // settlement is exactly the case that must not be silently suppressed.
    expect(isDurablyIgnored(item([marked]), 'pending_in_app')).toBe(false);
    expect(isDurablyIgnored(item([marked]), 'amount_differs')).toBe(false);
  });

  it('keeps a half-marked decision live', () => {
    // The rows that remain are the ones that do not add up; hiding them because
    // their neighbours were cleared would bury the part still needing an answer.
    expect(isDurablyIgnored(item([marked, { id: 'b' }]), 'combination')).toBe(false);
  });
});
