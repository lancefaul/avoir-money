/**
 * An empty session id splices into `/reconciliations//import`, which the server
 * answers with a bare 404 — indistinguishable from a session that genuinely
 * does not exist. That ambiguity sent one debugging session looking at the
 * route layer when the id had simply never arrived. These assert the client
 * refuses to build such a URL at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reconciliationsApi } from './reconciliations.js';

beforeEach(() => {
  // Any call reaching the network would mean the guard did not fire.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('fetch should not be reached'))),
  );
});

const CALLS: [string, () => unknown][] = [
  ['get', () => reconciliationsApi.get('')],
  ['update', () => reconciliationsApi.update('', { statementEndingBalance: 1 })],
  ['importStatement', () => reconciliationsApi.importStatement('', 'a,b')],
  ['match', () => reconciliationsApi.match('')],
  [
    'createMatch',
    () => reconciliationsApi.createMatch('', { statementRowId: 'r', transactionId: 't' }),
  ],
  ['deleteMatch', () => reconciliationsApi.deleteMatch('', 'm')],
  ['close', () => reconciliationsApi.close('')],
  ['adjustment', () => reconciliationsApi.adjustment('', 'why')],
  ['abandon', () => reconciliationsApi.abandon('')],
];

describe('reconciliationsApi rejects an empty session id', () => {
  it.each(CALLS)('%s', (_name, call) => {
    expect(call).toThrow(/no reconciliation session id/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('still allows the calls that legitimately take no id', async () => {
    // `list` reaches the network, so the stub rejects — the point is only that
    // the guard did not fire first. Awaiting keeps the rejection handled.
    await expect(reconciliationsApi.list()).rejects.toThrow('fetch should not be reached');
  });
});
