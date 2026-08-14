/**
 * Choosing an external dump.
 *
 * The panel's job is to make the confirmation that follows meaningful: it
 * reports what the server found *inside* the archive, so the user is agreeing
 * to replace their database based on the dump's own contents rather than on a
 * filename they are trusting from memory. The other half of its job is refusal
 * — a file the server rejected must never become selectable, because the next
 * button along runs `pg_restore --clean`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RestoreUploadPanel from './RestoreUploadPanel.js';
import type { DumpPreview } from '@budget-tracker/core';

const uploadMock = vi.fn();

vi.mock('../../hooks/useBackups.js', () => ({
  useUploadDump: () => ({ mutate: uploadMock, isPending: false }),
}));

const PREVIEW: DumpPreview = {
  uploadId: 'up-abc123',
  sizeBytes: 376_832,
  tableCount: 42,
  archiveCreatedAt: '2026-08-08 15:12:00 CDT',
  sourceDatabase: 'budget_tracker',
};

beforeEach(() => uploadMock.mockReset());

/*
 * Callbacks are optional-chained because the spy also receives one spurious
 * zero-argument call from the test runner itself — confirmed by a stack trace
 * with no React frames in it. The component's own call always carries both the
 * file and the callbacks; this only stops the stray one throwing.
 */
function respond(
  impl: (opts: { onSuccess: (p: DumpPreview) => void; onError: (e: Error) => void }) => void,
) {
  uploadMock.mockImplementation((_file, opts) => {
    if (opts) impl(opts);
  });
}

function setup(preview: DumpPreview | null = null) {
  const onPreview = vi.fn();
  render(<RestoreUploadPanel preview={preview} onPreview={onPreview} />);
  return { onPreview, user: userEvent.setup() };
}

async function pick(user: ReturnType<typeof userEvent.setup>, name = 'backup.dump') {
  const input = screen.getByLabelText('Dump file to restore');
  await user.upload(input, new File(['PGDMP…'], name, { type: 'application/octet-stream' }));
}

describe('RestoreUploadPanel', () => {
  it('sends the chosen file for validation', async () => {
    const { user } = setup();
    await pick(user);

    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect((uploadMock.mock.calls[0]![0] as File).name).toBe('backup.dump');
  });

  it('reports what the archive contains, not just that it was accepted', async () => {
    // The figures are the entire reason this step exists — without them the
    // confirmation is made against a filename.
    setup(PREVIEW);

    expect(screen.getByText(/42 tables/)).toBeInTheDocument();
    expect(screen.getByText(/2026-08-08 15:12:00 CDT/)).toBeInTheDocument();
    expect(screen.getByText(/budget_tracker/)).toBeInTheDocument();
  });

  it('surfaces a refusal inline so it stays on screen while another file is picked', async () => {
    respond((opts) =>
      opts.onError(new Error('That dump is not from Budget Tracker — it is missing Transaction.')),
    );
    const { user } = setup();
    await pick(user, 'someone-elses.dump');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/not from Budget Tracker/);
  });

  it('reports no preview when the file is refused', async () => {
    // A rejected file must not arm the Continue button in the parent.
    respond((opts) => opts.onError(new Error('nope')));
    const { user, onPreview } = setup();
    await pick(user);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    // Called only with the clearing call made before the request.
    expect(onPreview).toHaveBeenCalledWith(null, 'backup.dump');
    expect(onPreview).not.toHaveBeenCalledWith(
      expect.objectContaining({ uploadId: expect.any(String) }),
      expect.anything(),
    );
  });

  it('clears any previous result before validating a new file', async () => {
    // Otherwise a stale accepted preview stays armed while a new, unvalidated
    // file is in flight.
    uploadMock.mockImplementation(() => {});
    const { user, onPreview } = setup(PREVIEW);
    await pick(user, 'second.dump');

    expect(onPreview).toHaveBeenCalledWith(null, 'second.dump');
  });

  it('passes the preview up when the file validates', async () => {
    respond((opts) => opts.onSuccess(PREVIEW));
    const { user, onPreview } = setup();
    await pick(user);

    await waitFor(() => expect(onPreview).toHaveBeenCalledWith(PREVIEW, 'backup.dump'));
  });
});
