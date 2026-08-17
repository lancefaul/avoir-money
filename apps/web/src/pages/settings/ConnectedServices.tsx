import { useState, useId } from 'react';
import { KeyRound, Check, X, ExternalLink, ClipboardPaste, Eye, EyeOff } from 'lucide-react';
import {
  buttonStyles,
  inputStyles,
  badgeStyles,
  linkStyles,
  IconButton,
  vars,
  DisplayHeading,
} from '@budget-tracker/ui';
import type { ServiceStatus } from '@budget-tracker/core';
import {
  useConnectedServices,
  useSetServiceKey,
  useClearServiceKey,
} from '../../hooks/useConnectedServices.js';
import { contentHeader, contentScroll } from '../../components/settings-modal.css.js';

interface ProviderMeta {
  name: string;
  blurb: string;
  url: string;
  /**
   * True when the service works with no key at all.
   *
   * Without this the row would read "Not connected", which is wrong and
   * alarming: Bitcoin prices have always worked keyless, and a Demo key only
   * raises the rate limit. The distinction is presentational, so it lives here
   * rather than in the server's status contract.
   */
  optional?: boolean;
}

const PROVIDER_LABELS: Record<string, ProviderMeta> = {
  finnhub: {
    name: 'Finnhub',
    blurb: 'Live stock quotes. Without a key, stocks show their last recorded figure.',
    url: 'https://finnhub.io/register',
  },
  coingecko: {
    name: 'CoinGecko',
    blurb: 'Bitcoin prices. Works without a key — add a free Demo key only if you hit rate limits.',
    url: 'https://www.coingecko.com/en/developers/dashboard',
    optional: true,
  },
};

/**
 * Bring-your-own-key settings.
 *
 * The key is write-only from here: it is sent once and never comes back, so
 * this screen can show which key is configured (its last four characters) but
 * can never redisplay it. Replacing means typing a new one, which is the
 * correct trade — a field that could repopulate would mean the server was
 * handing the credential back on every page load.
 *
 * Bitcoin pricing is deliberately absent: CoinGecko is free and keyless, so
 * there is nothing to connect and nothing that breaks when this list is empty.
 */
export default function ConnectedServices() {
  const { data: services, isLoading } = useConnectedServices();

  return (
    <>
      <div className={contentHeader}>
        <DisplayHeading size="sm">Connected Services</DisplayHeading>
        <p style={{ fontSize: vars.font.sm, color: vars.color.textSecondary, margin: 0 }}>
          Your own API keys for optional live data. Everything else in the app works without them.
        </p>
      </div>

      <div className={contentScroll}>
        {isLoading ? null : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['4'] }}>
            {(services ?? []).map((service) => (
              <ServiceRow key={service.provider} service={service} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function ServiceRow({ service }: { service: ServiceStatus }) {
  const fid = useId();
  const [value, setValue] = useState('');
  const [editing, setEditing] = useState(false);
  const [pasteError, setPasteError] = useState<string | null>(null);
  /*
   * A secret field that cannot be revealed is a secret field whose contents
   * cannot be checked — and that cost an hour on 2026-08-12. Clicking Paste AND
   * pressing Ctrl+V produces exactly double the key, `length 8..500` waves it
   * through, and behind dots there is nothing on screen to show it. Finnhub
   * then rejected the key, and the app reported the consequence two pages away.
   *
   * Reveal starts off on every render rather than being remembered: the reason
   * for `type="password"` here is shoulder-readability, and a toggle that
   * persisted would quietly defeat it the next time the page opened.
   */
  const [revealed, setRevealed] = useState(false);
  const setKey = useSetServiceKey();
  const clearKey = useClearServiceKey();

  const meta = PROVIDER_LABELS[service.provider] ?? {
    name: service.provider,
    blurb: '',
    url: '',
  };

  /*
   * Read the key from the clipboard.
   *
   * `navigator.clipboard` requires a secure context, and this app is served
   * over plain HTTP at budget.local — so on the LAN the API is simply absent
   * and the read throws in the browser. Both are reported rather than swallowed:
   * a paste button that silently does nothing is worse than no button.
   */
  async function paste() {
    setPasteError(null);
    try {
      const text = await navigator.clipboard?.readText();
      if (!text) throw new Error('The clipboard is empty.');
      setValue(text.trim());
    } catch {
      setPasteError('Could not read the clipboard — paste with Ctrl+V instead.');
    }
  }

  /*
   * Ctrl+V REPLACES the field instead of inserting at the cursor.
   *
   * This is deliberately not the browser's default, because the default is what
   * produced the bug. The Paste button assigns the whole value; a Ctrl+V after
   * it inserts at the caret, which is sitting at the end — so pressing both, the
   * natural thing to do when a button appears not to have worked, silently
   * yields the key twice. `length 8..500` waves 80 characters through, the
   * field shows dots, and Finnhub then rejects a key that looks correct
   * everywhere the user can see. Captured live on 2026-08-12: 80 characters,
   * exactly the 40-character key repeated.
   *
   * Replacing makes the doubling unexpressible rather than merely visible.
   * Revealing the field shows the mistake to someone who already suspects one;
   * this stops it happening to someone who does not. A secret field holds one
   * whole value, so there is no legitimate case for appending to it.
   */
  function onPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    setPasteError(null);
    const text = e.clipboardData.getData('text');
    if (text) setValue(text.trim());
  }

  function save() {
    if (value.trim().length < 8) return;
    setKey.mutate(
      { provider: service.provider, apiKey: value.trim() },
      {
        onSuccess: () => {
          // Cleared immediately: there is no reason for the key to stay in
          // component state once it has been stored.
          setValue('');
          setEditing(false);
        },
      },
    );
  }

  // A required service with no key opens its form immediately, because nothing
  // works until it is filled. An optional one does not — it already works, so
  // the form is opt-in behind "Add key".
  const showForm = editing || (!service.configured && !meta.optional);

  return (
    /* One card per service, matching the budget rows: surface on the page
       background, hairline border, lg radius. Each service is an independent
       thing you configure, so it gets its own container rather than sharing a
       list — there is no relationship between them to express. */
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: vars.space['2'],
        background: vars.color.surface,
        border: `${vars.border.thin} solid ${vars.color.border}`,
        borderRadius: vars.radius.lg,
        padding: `${vars.space['4']} ${vars.space['4']}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: vars.space['2'] }}>
        <KeyRound size={16} />
        <strong style={{ fontSize: vars.font.base }}>{meta.name}</strong>
        {service.configured ? (
          <span className={`${badgeStyles.badge} ${badgeStyles.badgePositive}`}>
            <Check size={12} /> Connected{service.hint ? ` · …${service.hint}` : ''}
          </span>
        ) : meta.optional ? (
          <span className={`${badgeStyles.badge} ${badgeStyles.badgeInfo}`}>
            <Check size={12} /> Active · no key needed
          </span>
        ) : (
          <span className={`${badgeStyles.badge} ${badgeStyles.badgeNeutral}`}>
            <X size={12} /> Not connected
          </span>
        )}
      </div>

      <p style={{ fontSize: vars.font.sm, color: vars.color.textSecondary, margin: 0 }}>
        {meta.blurb}{' '}
        {meta.url && (
          <a
            href={meta.url}
            target="_blank"
            rel="noopener noreferrer"
            className={linkStyles.linkExternal}
          >
            Get a free key <ExternalLink size={12} />
          </a>
        )}
      </p>

      {/* An env-supplied key is reported but not editable here: it lives in a
          file this screen cannot write, and offering Replace would silently
          shadow it rather than change it. */}
      {service.source === 'environment' && (
        <p style={{ fontSize: vars.font.sm, color: vars.color.textTertiary, margin: 0 }}>
          Currently using the key from the server environment. Saving one here replaces it.
        </p>
      )}

      {!service.storageAvailable && (
        <p role="alert" style={{ fontSize: vars.font.sm, color: vars.color.warning700, margin: 0 }}>
          The server has no <code>INTEGRATION_SECRET</code>, so keys cannot be stored securely. Add
          one to the API environment and restart.
        </p>
      )}

      {showForm ? (
        <div style={{ display: 'flex', gap: vars.space['2'], alignItems: 'flex-start' }}>
          <div className={inputStyles.field} style={{ flex: 1 }}>
            <label htmlFor={`${fid}-key`} className={inputStyles.fieldLabel}>
              API key
            </label>
            <div className={inputStyles.inputWrap}>
              <input
                id={`${fid}-key`}
                className={inputStyles.input}
                // Masked by default, and not by accident: this is a secret being
                // typed in, so it should not be shoulder-readable or offered to
                // a password manager as a login. Revealable on demand, because
                // a value nobody can see is a value nobody can check.
                type={revealed ? 'text' : 'password'}
                autoComplete="off"
                spellCheck={false}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onPaste={onPaste}
                placeholder="Paste your key"
                disabled={!service.storageAvailable || setKey.isPending}
                // Room for BOTH actions so a long key never runs under them.
                style={{ paddingRight: '4.5rem' }}
              />
              <div className={inputStyles.inputActions}>
                <IconButton
                  icon={revealed ? <EyeOff size={14} /> : <Eye size={14} />}
                  tooltip={revealed ? 'Hide key' : 'Show key'}
                  size="sm"
                  onClick={() => setRevealed((r) => !r)}
                  // Deliberately NOT disabled while saving: the whole point is
                  // being able to check what is about to be sent.
                  disabled={!service.storageAvailable}
                />
                <IconButton
                  icon={<ClipboardPaste size={14} />}
                  tooltip="Paste from clipboard"
                  size="sm"
                  onClick={paste}
                  disabled={!service.storageAvailable || setKey.isPending}
                />
              </div>
            </div>
            {pasteError && (
              <span className={inputStyles.fieldError} role="alert">
                {pasteError}
              </span>
            )}
          </div>
          <button
            type="button"
            className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
            style={{ marginTop: '1.5rem' }}
            onClick={save}
            disabled={value.trim().length < 8 || !service.storageAvailable || setKey.isPending}
          >
            {setKey.isPending ? 'Saving…' : 'Save'}
          </button>
          {editing && (
            <button
              type="button"
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
              style={{ marginTop: '1.5rem' }}
              onClick={() => {
                setValue('');
                setEditing(false);
              }}
            >
              Cancel
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: vars.space['2'] }}>
          <button
            type="button"
            className={`${buttonStyles.btnBase} ${buttonStyles.btnSm} ${buttonStyles.btnSecondary}`}
            onClick={() => setEditing(true)}
          >
            {service.configured ? 'Replace key' : 'Add key'}
          </button>
          {service.source === 'database' && (
            <button
              type="button"
              className={`${buttonStyles.btnBase} ${buttonStyles.btnSm} ${buttonStyles.btnTrueGhostDanger}`}
              onClick={() => clearKey.mutate(service.provider)}
              disabled={clearKey.isPending}
            >
              Remove
            </button>
          )}
        </div>
      )}
    </div>
  );
}
