import { mkdtemp, mkdir, rm, writeFile, stat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep, basename } from 'node:path';

/**
 * Where an uploaded dump waits between being validated and being restored.
 *
 * The whole point of this module is that **no string from the client ever
 * becomes part of a path**. The upload writes to a directory this process
 * creates, under a fixed filename this process chooses; the caller receives
 * only an opaque id. `resolveUpload` is the one place that id turns back into a
 * path, and it refuses anything that is not a plain token which resolves inside
 * the staging root — so a `../` or an absolute path cannot address a file
 * elsewhere on the host, and the restore endpoint cannot be aimed at, say,
 * `/etc/passwd` or another user's dump.
 */

const STAGING_ROOT = join(tmpdir(), 'budget-tracker-uploads');

/** Fixed — the uploaded file's own name is never used. */
const STAGED_FILENAME = 'upload.dump';

/** mkdtemp suffixes are alphanumeric; nothing else is a valid id. */
const UPLOAD_ID = /^[A-Za-z0-9_-]{6,64}$/;

/** Stale staging directories are swept after this long. */
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

export interface StagedUpload {
  uploadId: string;
  filepath: string;
}

/**
 * Write an uploaded dump to a fresh staging directory.
 *
 * Returns an opaque id, never a path.
 */
export async function stageUpload(bytes: Uint8Array): Promise<StagedUpload> {
  await mkdir(STAGING_ROOT, { recursive: true });
  const dir = await mkdtemp(join(STAGING_ROOT, 'up-'));
  const filepath = join(dir, STAGED_FILENAME);
  await writeFile(filepath, bytes);
  return { uploadId: basename(dir), filepath };
}

/**
 * Turn an id from the client back into a path, or null if it is not one.
 *
 * Two independent guards, because either alone has failed somewhere before: the
 * pattern rejects separators and traversal outright, and the containment check
 * catches anything the pattern let through by confirming the resolved path is
 * genuinely inside the staging root rather than merely starting with its name.
 */
export async function resolveUpload(uploadId: string): Promise<string | null> {
  if (!UPLOAD_ID.test(uploadId)) return null;

  const candidate = resolve(STAGING_ROOT, uploadId, STAGED_FILENAME);
  if (!candidate.startsWith(resolve(STAGING_ROOT) + sep)) return null;

  try {
    const s = await stat(candidate);
    if (!s.isFile()) return null;
  } catch {
    return null;
  }
  return candidate;
}

/** Remove one staging directory. Never throws — cleanup is not the operation. */
export async function discardUpload(uploadId: string): Promise<void> {
  if (!UPLOAD_ID.test(uploadId)) return;
  const dir = resolve(STAGING_ROOT, uploadId);
  if (!dir.startsWith(resolve(STAGING_ROOT) + sep)) return;
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

/**
 * Delete staging directories left behind by uploads that were never restored.
 *
 * An upload that is validated and then abandoned would otherwise sit in the
 * temp directory holding a full copy of the database indefinitely.
 */
export async function sweepStaleUploads(now = Date.now()): Promise<number> {
  let entries: string[];
  try {
    entries = await readdir(STAGING_ROOT);
  } catch {
    return 0;
  }

  let removed = 0;
  for (const entry of entries) {
    if (!UPLOAD_ID.test(entry)) continue;
    const dir = join(STAGING_ROOT, entry);
    try {
      const s = await stat(dir);
      if (now - s.mtimeMs > STALE_AFTER_MS) {
        await rm(dir, { recursive: true, force: true });
        removed += 1;
      }
    } catch {
      // Vanished under us, or unreadable — either way not ours to chase.
    }
  }
  return removed;
}
