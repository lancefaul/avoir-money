import { prisma } from '@budget-tracker/db';
import { seal, open, hintOf, canStoreSecrets, MissingSecretError } from './secret-box.js';

/**
 * API keys the user has supplied for third-party services.
 *
 * The rule this module exists to enforce is that **a stored key leaves here in
 * exactly one direction**: `getServiceKey` hands it to the code that calls the
 * provider, and nothing else ever returns it. Everything a client can reach
 * goes through `getServiceStatus`, which reports whether a key exists and its
 * last four characters and nothing more.
 */

export const FINNHUB = 'finnhub';

/**
 * CoinGecko is optional, unlike Finnhub.
 *
 * Bitcoin prices work with no key at all — that is why they have always worked
 * in this app while stocks never did. A Demo key only raises the rate limit, so
 * "not configured" here is a healthy state, not a broken one, and the UI has to
 * say so rather than reporting it the way it reports a missing Finnhub key.
 */
export const COINGECKO = 'coingecko';

export interface ServiceStatus {
  provider: string;
  configured: boolean;
  /** Last 4 characters of the key, or '' when unknown or too short to hint. */
  hint: string;
  /** Where the key in use came from, so the UI can explain what it is seeing. */
  source: 'database' | 'environment' | 'none';
  updatedAt: Date | null;
  /**
   * False when the server has no INTEGRATION_SECRET. Storing a key is refused
   * in that state, and the UI needs to say why rather than offer a form whose
   * submit always fails.
   */
  storageAvailable: boolean;
}

/** Environment fallbacks, so an existing install keeps working untouched. */
const ENV_FALLBACK: Record<string, string | undefined> = {
  [FINNHUB]: 'FINNHUB_API_KEY',
  [COINGECKO]: 'COINGECKO_API_KEY',
};

function envKeyFor(provider: string): string | null {
  const name = ENV_FALLBACK[provider];
  if (!name) return null;
  const value = process.env[name];
  return value && value.trim() !== '' ? value : null;
}

/**
 * The key to use when calling a provider, or null if there is none.
 *
 * The database wins over the environment: a key entered in the UI is the more
 * recent, more deliberate act, and an env var left over from an earlier setup
 * should not silently override what the user just typed. The env var remains a
 * working fallback so upgrading changes nothing for an existing install.
 *
 * An undecryptable row (rotated or missing INTEGRATION_SECRET) falls through to
 * the environment and then to null, rather than throwing — see `open`.
 */
export async function getServiceKey(provider: string): Promise<string | null> {
  const row = await prisma.connectedService.findUnique({ where: { provider } });
  if (row) {
    const key = open({ cipher: row.secretCipher, iv: row.secretIv, tag: row.secretTag });
    if (key) return key;
  }
  return envKeyFor(provider);
}

/** Everything a client is allowed to know about a stored key. */
export async function getServiceStatus(provider: string): Promise<ServiceStatus> {
  const row = await prisma.connectedService.findUnique({ where: { provider } });

  if (row) {
    const key = open({ cipher: row.secretCipher, iv: row.secretIv, tag: row.secretTag });
    if (key) {
      return {
        provider,
        configured: true,
        hint: row.hint,
        source: 'database',
        updatedAt: row.updatedAt,
        storageAvailable: canStoreSecrets(),
      };
    }
    // A row exists but cannot be read — a rotated or missing secret. Reported as
    // unconfigured because that is what it is operationally, and the fallback
    // below is what will actually be used.
  }

  const envKey = envKeyFor(provider);
  if (envKey) {
    return {
      provider,
      configured: true,
      hint: hintOf(envKey),
      source: 'environment',
      updatedAt: null,
      storageAvailable: canStoreSecrets(),
    };
  }

  return {
    provider,
    configured: false,
    hint: '',
    source: 'none',
    updatedAt: null,
    storageAvailable: canStoreSecrets(),
  };
}

/**
 * Store a key for a provider, replacing any existing one.
 *
 * Throws `MissingSecretError` when the server cannot encrypt. Refusing is the
 * only honest option: the alternative is writing the key in plain text into the
 * very dumps this design exists to keep it out of.
 */
export async function setServiceKey(provider: string, apiKey: string): Promise<ServiceStatus> {
  if (!canStoreSecrets()) throw new MissingSecretError();

  const trimmed = apiKey.trim();
  const sealed = seal(trimmed);
  const hint = hintOf(trimmed);

  await prisma.connectedService.upsert({
    where: { provider },
    create: {
      provider,
      secretCipher: sealed.cipher,
      secretIv: sealed.iv,
      secretTag: sealed.tag,
      hint,
    },
    update: {
      secretCipher: sealed.cipher,
      secretIv: sealed.iv,
      secretTag: sealed.tag,
      hint,
    },
  });

  return getServiceStatus(provider);
}

/** Remove a stored key. Silent when there was none — the end state is the same. */
export async function clearServiceKey(provider: string): Promise<ServiceStatus> {
  await prisma.connectedService.deleteMany({ where: { provider } });
  return getServiceStatus(provider);
}
