/**
 * `/preferences` in the TypeScript reference (ADR-042, ADR-041).
 *
 * Every assertion reads the row back rather than trusting the response, for the
 * reason ERRORS.md records twice: a handler that answers 200 with a well-formed
 * body is not a handler that wrote anything. `POST /transactions` returned 201
 * with a real id for months while writing no `TradeDetail` at all, and the
 * response was the half that looked right.
 *
 * The upsert is the property most worth pinning. Getting it wrong does not
 * fail — it appends a second row, and the read then returns whichever one the
 * database happens to hand back first. That is exactly the escrow defect
 * (ADR-032): a write that succeeded and a read that could not see it, which
 * sends the investigation to the write path where nothing is wrong.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@budget-tracker/db';
import { get, put, del } from '../test/helpers.js';

const KEY = 'budget-tracker-ui';
const VALUE = JSON.stringify({ state: { hiddenAccountIds: ['a1', 'b2'] }, version: 1 });

beforeEach(async () => {
  await prisma.uiPreference.deleteMany({});
});

describe('GET /preferences', () => {
  it('returns an empty object when nothing is stored', async () => {
    const res = await get('/preferences');
    expect(res.status).toBe(200);
    // `{}` and not a 404: "nothing stored yet" is the ordinary first-run state,
    // and a client that had to treat it as an error would put a failure on the
    // path every fresh install takes.
    expect(await res.json()).toEqual({});
  });

  it('returns every stored key as one flat object', async () => {
    await prisma.uiPreference.createMany({
      data: [
        { key: 'a', value: '1' },
        { key: 'b', value: '2' },
      ],
    });

    const res = await get('/preferences');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ a: '1', b: '2' });
  });
});

describe('PUT /preferences', () => {
  it('stores the value and returns the key', async () => {
    const res = await put('/preferences', { key: KEY, value: VALUE });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ key: KEY });

    const row = await prisma.uiPreference.findUniqueOrThrow({ where: { key: KEY } });
    expect(row.value).toBe(VALUE);
  });

  it('overwrites on a second write instead of adding a row', async () => {
    await put('/preferences', { key: KEY, value: 'first' });
    await put('/preferences', { key: KEY, value: 'second' });

    // Both halves matter. The count catches an insert-instead-of-update, which
    // is silent; the value catches an update that wrote the wrong row.
    expect(await prisma.uiPreference.count({ where: { key: KEY } })).toBe(1);
    const row = await prisma.uiPreference.findUniqueOrThrow({ where: { key: KEY } });
    expect(row.value).toBe('second');
  });

  it('stores the value verbatim, without parsing it', async () => {
    // The server is a storage adapter and has no opinion about the shape. A
    // server that validated it would need changing every time the interface
    // grows a setting — so a value that is not JSON at all must round-trip.
    const junk = 'not json {{{ at all';
    await put('/preferences', { key: 'k', value: junk });

    const row = await prisma.uiPreference.findUniqueOrThrow({ where: { key: 'k' } });
    expect(row.value).toBe(junk);
  });

  it('accepts an empty string as a value', async () => {
    // Empty is a legitimate stored value, distinct from absent. `removeItem` is
    // how a client says absent.
    const res = await put('/preferences', { key: 'k', value: '' });
    expect(res.status).toBe(200);

    const row = await prisma.uiPreference.findUniqueOrThrow({ where: { key: 'k' } });
    expect(row.value).toBe('');
  });

  it('refuses an empty key', async () => {
    const res = await put('/preferences', { key: '', value: 'x' });
    expect(res.status).toBe(400);
    expect(await prisma.uiPreference.count()).toBe(0);
  });

  it('refuses a value past the size bound, and writes nothing', async () => {
    const res = await put('/preferences', { key: 'k', value: 'x'.repeat(256 * 1024 + 1) });
    expect(res.status).toBe(400);
    // The bound exists because this is an unvalidated blob from the renderer.
    // A refusal that still wrote the row would defeat it entirely.
    expect(await prisma.uiPreference.count()).toBe(0);
  });

  it('accepts a value exactly at the bound', async () => {
    const res = await put('/preferences', { key: 'k', value: 'x'.repeat(256 * 1024) });
    expect(res.status).toBe(200);
    expect(await prisma.uiPreference.count()).toBe(1);
  });
});

describe('DELETE /preferences/:key', () => {
  it('removes the key', async () => {
    await put('/preferences', { key: KEY, value: VALUE });

    const res = await del(`/preferences/${KEY}`);
    expect(res.status).toBe(204);
    expect(await prisma.uiPreference.findUnique({ where: { key: KEY } })).toBeNull();
  });

  it('is idempotent — deleting what is not there is not an error', async () => {
    // The client's `removeItem` has no way to find out first and nothing
    // meaningful to do if told. A 404 here would turn a no-op into a failure
    // the storage adapter would have to swallow.
    const res = await del('/preferences/never-stored');
    expect(res.status).toBe(204);
  });

  it('removes only the named key', async () => {
    await put('/preferences', { key: 'keep', value: '1' });
    await put('/preferences', { key: 'drop', value: '2' });

    await del('/preferences/drop');

    const rows = await prisma.uiPreference.findMany({ select: { key: true } });
    expect(rows.map((r) => r.key)).toEqual(['keep']);
  });
});
