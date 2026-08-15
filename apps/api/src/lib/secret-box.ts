import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

/**
 * Authenticated encryption for third-party credentials held in the database.
 *
 * The threat this addresses is specific and worth stating, because it is easy
 * to overclaim. The database is dumped to files that are downloaded over the
 * API, uploaded from other machines, and kept in cloud storage. A plaintext API
 * key would travel in every one of them. Encrypting means **a dump on its own
 * is not a credential leak**.
 *
 * It does NOT defend against someone who has both the dump and the server's
 * environment — the secret is right there. That is an accepted limit, not an
 * oversight: any scheme where the server can decrypt unattended has a key the
 * server can reach, and this app has no operator to type a passphrase.
 *
 * GCM rather than CBC so tampering is detectable: a modified ciphertext fails
 * the auth tag instead of decrypting to plausible garbage that then gets sent
 * to a third party as if it were a key.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // GCM standard; a fresh one per encryption, never reused.

export class MissingSecretError extends Error {
  constructor() {
    super(
      'INTEGRATION_SECRET is not set, so connected-service keys cannot be stored. ' +
        'Add it to the API environment (openssl rand -hex 32) and restart.',
    );
    this.name = 'MissingSecretError';
  }
}

/**
 * Derive a 32-byte key from the configured secret.
 *
 * Hashed rather than used raw so any length of secret works — an operator
 * pasting a 40-character string should not produce a cipher that throws about
 * key length. This is not password stretching; the input is a machine-generated
 * secret, not a memorised password, so a KDF's work factor buys nothing here.
 */
function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest();
}

function readSecret(): string {
  const secret = process.env.INTEGRATION_SECRET;
  if (!secret || secret.trim() === '') throw new MissingSecretError();
  return secret;
}

/** True when the server is configured to store secrets at all. */
export function canStoreSecrets(): boolean {
  const secret = process.env.INTEGRATION_SECRET;
  return Boolean(secret && secret.trim() !== '');
}

export interface SealedSecret {
  cipher: string;
  iv: string;
  tag: string;
}

export function seal(plaintext: string): SealedSecret {
  const key = deriveKey(readSecret());
  const iv = randomBytes(IV_BYTES);
  const c = createCipheriv(ALGORITHM, key, iv);
  const cipher = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return {
    cipher: cipher.toString('base64'),
    iv: iv.toString('base64'),
    tag: c.getAuthTag().toString('base64'),
  };
}

/**
 * Recover a sealed secret, or null if it cannot be recovered.
 *
 * Returns null rather than throwing for a wrong secret or tampered ciphertext,
 * because both mean the same thing to every caller: there is no usable key
 * here. Treating that as "not configured" degrades to no live prices, which the
 * app already handles, instead of turning a rotated secret into a crash on a
 * page that has nothing to do with integrations.
 */
export function open(sealed: SealedSecret): string | null {
  try {
    const key = deriveKey(readSecret());
    const d = createDecipheriv(ALGORITHM, key, Buffer.from(sealed.iv, 'base64'));
    d.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(sealed.cipher, 'base64')), d.final()]).toString(
      'utf8',
    );
  } catch {
    return null;
  }
}

/**
 * The last four characters, for showing which key is configured.
 *
 * Short keys are hinted as empty rather than partially revealed — a 4-character
 * secret would otherwise be printed in full by its own hint.
 */
export function hintOf(plaintext: string): string {
  return plaintext.length > 8 ? plaintext.slice(-4) : '';
}
