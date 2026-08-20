/**
 * Bring-your-own-key settings.
 *
 * The screen is write-only by design: the server never returns a stored key, so
 * this can show which key is configured but never redisplay it. These tests pin
 * the handling that follows from that — the field is a password input, it is
 * cleared the moment the key is stored, and a configured service offers Replace
 * rather than a prefilled box.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConnectedServices from './ConnectedServices.js';
import type { ServiceStatus } from '@budget-tracker/core';

const setMock = vi.fn();
const clearMock = vi.fn();
const listMock = vi.fn();

/** Flipped by the one test that needs a save in flight; reset in beforeEach. */
let setPending = false;

vi.mock('../../hooks/useConnectedServices.js', () => ({
  useConnectedServices: () => listMock(),
  useSetServiceKey: () => ({ mutate: setMock, isPending: setPending }),
  useClearServiceKey: () => ({ mutate: clearMock, isPending: false }),
}));

const NOT_CONNECTED: ServiceStatus = {
  provider: 'finnhub',
  configured: false,
  hint: '',
  source: 'none',
  updatedAt: null,
  storageAvailable: true,
};

const CONNECTED: ServiceStatus = {
  ...NOT_CONNECTED,
  configured: true,
  hint: 'cd12',
  source: 'database',
  updatedAt: new Date('2026-08-08T00:00:00.000Z'),
};

function setup(service: ServiceStatus) {
  listMock.mockReturnValue({ data: [service], isLoading: false });
  render(<ConnectedServices />);
  return userEvent.setup();
}

beforeEach(() => {
  setMock.mockReset();
  clearMock.mockReset();
  listMock.mockReset();
  setPending = false;
});

describe('ConnectedServices', () => {
  it('offers a key field when nothing is connected', async () => {
    setup(NOT_CONNECTED);

    expect(screen.getByText('Not connected')).toBeInTheDocument();
    expect(screen.getByLabelText('API key')).toBeInTheDocument();
  });

  it('masks the key while it is being typed', async () => {
    const user = setup(NOT_CONNECTED);
    const field = screen.getByLabelText('API key');

    await user.type(field, 'fnhb_secret_value');

    // A credential being entered should not be shoulder-readable, and should
    // not be offered to a password manager as a login.
    expect(field).toHaveAttribute('type', 'password');
    expect(field).toHaveAttribute('autocomplete', 'off');
  });

  it('sends the key and then clears the field', async () => {
    const user = setup(NOT_CONNECTED);
    await user.type(screen.getByLabelText('API key'), 'fnhb_secret_value');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(setMock).toHaveBeenCalledWith(
      { provider: 'finnhub', apiKey: 'fnhb_secret_value' },
      expect.anything(),
    );

    // The success path clears it — there is no reason for a stored key to stay
    // in component state.
    const opts = setMock.mock.calls[0]![1] as { onSuccess: () => void };
    opts.onSuccess();
    await waitFor(() => expect(screen.getByLabelText('API key')).toHaveValue(''));
  });

  it('refuses to send an implausibly short key', async () => {
    const user = setup(NOT_CONNECTED);
    await user.type(screen.getByLabelText('API key'), 'abc');

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(setMock).not.toHaveBeenCalled();
  });

  it('shows only the hint for a connected service, never a prefilled key', async () => {
    setup(CONNECTED);

    // Matched on the hint itself — /Connected/ also hits the page heading.
    expect(screen.getByText(/…cd12/)).toBeInTheDocument();
    // No field at all until Replace is chosen: a box that could repopulate
    // would mean the server was handing the credential back.
    expect(screen.queryByLabelText('API key')).not.toBeInTheDocument();
  });

  it('opens an empty field on Replace', async () => {
    const user = setup(CONNECTED);
    await user.click(screen.getByRole('button', { name: 'Replace key' }));

    expect(screen.getByLabelText('API key')).toHaveValue('');
  });

  it('can remove a stored key', async () => {
    const user = setup(CONNECTED);
    await user.click(screen.getByRole('button', { name: 'Remove' }));

    expect(clearMock).toHaveBeenCalledWith('finnhub');
  });

  it('does not offer Remove for a key that lives in the environment', async () => {
    // It is in a file this screen cannot write; a Remove button would appear to
    // work and change nothing.
    setup({ ...CONNECTED, source: 'environment' });

    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  describe('paste action', () => {
    function stubClipboard(impl: () => Promise<string>) {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { readText: impl },
      });
    }

    it('fills the field from the clipboard', async () => {
      const user = setup(NOT_CONNECTED);
      // After setup(): userEvent.setup() installs its own clipboard stub, and
      // stubbing first would simply be overwritten.
      stubClipboard(async () => '  fnhb_pasted_key  ');

      await user.click(screen.getByRole('button', { name: 'Paste from clipboard' }));

      // Trimmed: a copied key routinely carries surrounding whitespace, and a
      // key with a stray space fails at the provider with an opaque error.
      await waitFor(() => expect(screen.getByLabelText('API key')).toHaveValue('fnhb_pasted_key'));
    });

    it('says so when the clipboard cannot be read', async () => {
      // The case this app will actually hit: navigator.clipboard needs a secure
      // context and the app is served over plain HTTP at budget.local, so the
      // API is absent on the LAN. A button that silently does nothing is worse
      // than no button.
      const user = setup(NOT_CONNECTED);
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });

      await user.click(screen.getByRole('button', { name: 'Paste from clipboard' }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(/Ctrl\+V/);
      expect(screen.getByLabelText('API key')).toHaveValue('');
    });

    it('says so when the clipboard is empty', async () => {
      const user = setup(NOT_CONNECTED);
      stubClipboard(async () => '');

      await user.click(screen.getByRole('button', { name: 'Paste from clipboard' }));

      expect(await screen.findByRole('alert')).toBeInTheDocument();
    });
  });

  describe('an optional service', () => {
    const COINGECKO: ServiceStatus = { ...NOT_CONNECTED, provider: 'coingecko' };

    it('reads as active rather than "not connected" with no key', async () => {
      // Bitcoin prices have always worked keyless. Reporting this the way a
      // missing Finnhub key is reported would be both wrong and alarming.
      setup(COINGECKO);

      expect(screen.getByText(/Active/)).toBeInTheDocument();
      expect(screen.queryByText('Not connected')).not.toBeInTheDocument();
    });

    it('does not sit open on a form nobody needs', async () => {
      // A required service opens its field immediately because nothing works
      // until it is filled. This one already works.
      setup(COINGECKO);

      expect(screen.queryByLabelText('API key')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add key' })).toBeInTheDocument();
    });

    it('still allows adding a key for rate limits', async () => {
      const user = setup(COINGECKO);
      await user.click(screen.getByRole('button', { name: 'Add key' }));
      await user.type(screen.getByLabelText('API key'), 'CG-demo-key-1234');
      await user.click(screen.getByRole('button', { name: 'Save' }));

      expect(setMock).toHaveBeenCalledWith(
        { provider: 'coingecko', apiKey: 'CG-demo-key-1234' },
        expect.anything(),
      );
    });

    it('offers Replace, not Add, once a key is stored', async () => {
      setup({ ...COINGECKO, configured: true, hint: 'e5f6', source: 'database' });

      expect(screen.getByRole('button', { name: 'Replace key' })).toBeInTheDocument();
    });
  });

  it('explains itself and disables saving when the server cannot store secrets', async () => {
    setup({ ...NOT_CONNECTED, storageAvailable: false });

    expect(screen.getByRole('alert')).toHaveTextContent(/INTEGRATION_SECRET/);
    expect(screen.getByLabelText('API key')).toBeDisabled();
  });
});

/**
 * The doubling bug, and the two controls added because of it.
 *
 * Captured live on 2026-08-12 against a scratch database: the field held 80
 * characters — a 40-character key repeated — the server's `length 8..500` check
 * waved it through, the save reported success, and Finnhub then rejected a key
 * that looked correct everywhere the user could see it.
 */
describe('pasting a key', () => {
  // Deliberately 40 characters, matching the real key whose doubling was caught.
  const KEY = 'd76sfmpq31xk9wbz20ncvtjr48ahglye5umnpo60';

  /*
   * Defined rather than assigned: jsdom exposes `navigator.clipboard` through a
   * getter, and `userEvent.setup()` installs its own stub over it — so this has
   * to run AFTER setup() and has to replace the property descriptor.
   */
  function withClipboard(text: string) {
    Object.defineProperty(navigator, 'clipboard', {
      value: { readText: vi.fn().mockResolvedValue(text) },
      configurable: true,
    });
  }

  it('does not double the key when Paste is clicked AND Ctrl+V pressed', async () => {
    // The exact sequence that produced the bug. Clicking the button appears to
    // do nothing (the field shows dots either way), so pressing Ctrl+V after it
    // is the natural next move — and the browser's default inserts at the caret,
    // which is sitting at the end.
    const user = setup(NOT_CONNECTED);
    withClipboard(KEY);
    const field = screen.getByLabelText('API key');

    await user.click(screen.getByRole('button', { name: 'Paste from clipboard' }));
    await waitFor(() => expect(field).toHaveValue(KEY));

    field.focus();
    await user.paste(KEY);

    expect(field).toHaveValue(KEY);
    expect(field).not.toHaveValue(KEY + KEY);
    expect((field as HTMLInputElement).value).toHaveLength(40);
  });

  it('sends the key once after that sequence', async () => {
    // The assertion that matters to the user: what reaches the server.
    const user = setup(NOT_CONNECTED);
    withClipboard(KEY);
    const field = screen.getByLabelText('API key');

    await user.click(screen.getByRole('button', { name: 'Paste from clipboard' }));
    await waitFor(() => expect(field).toHaveValue(KEY));
    field.focus();
    await user.paste(KEY);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(setMock).toHaveBeenCalledWith({ provider: 'finnhub', apiKey: KEY }, expect.anything());
  });

  it('replaces rather than appends on a plain Ctrl+V into a filled field', async () => {
    const user = setup(NOT_CONNECTED);
    const field = screen.getByLabelText('API key');

    await user.type(field, 'old-key-value');
    field.focus();
    await user.paste(KEY);

    // A secret field holds one whole value, so replacing is the only sensible
    // reading of a paste into it.
    expect(field).toHaveValue(KEY);
  });
});

describe('revealing the key', () => {
  it('is masked until asked, then shows the value', async () => {
    const user = setup(NOT_CONNECTED);
    const field = screen.getByLabelText('API key');
    expect(field).toHaveAttribute('type', 'password');

    await user.click(screen.getByRole('button', { name: 'Show key' }));
    expect(field).toHaveAttribute('type', 'text');

    await user.click(screen.getByRole('button', { name: 'Hide key' }));
    expect(field).toHaveAttribute('type', 'password');
  });

  it('starts masked again on a fresh mount', async () => {
    // Not remembered on purpose: the reason for masking is shoulder-
    // readability, and a toggle that persisted would quietly defeat it the next
    // time the page opened.
    const user = setup(NOT_CONNECTED);
    await user.click(screen.getByRole('button', { name: 'Show key' }));
    expect(screen.getByLabelText('API key')).toHaveAttribute('type', 'text');

    cleanup();
    setup(NOT_CONNECTED);
    expect(screen.getByLabelText('API key')).toHaveAttribute('type', 'password');
  });

  it('can still reveal while a save is in flight', async () => {
    // Deliberately not disabled with the rest of the form: being able to check
    // what is about to be sent is the entire point of the control.
    setPending = true;
    setup(NOT_CONNECTED);
    expect(screen.getByRole('button', { name: 'Show key' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Paste from clipboard' })).toBeDisabled();
  });
});
