/**
 * The backend must exit when the shell's stdin pipe closes — and must NOT exit
 * when it was never supervised.
 *
 * Both directions matter. The positive case alone is satisfied by a backend
 * that exits on startup for any reason at all; the negative case is what
 * distinguishes "noticed the parent leave" from "fell over". And the gate is
 * not academic: a terminal or CI run has stdin on /dev/null, which reads EOF
 * immediately, so a backend that watched the pipe unconditionally would die the
 * moment it started.
 *
 * Windows is why this is a CI step rather than a comment. PDEATHSIG and the
 * getppid poll are unix-only, so there the pipe is the only orphan protection
 * there is — and an orphan holds the database lock, which makes the next launch
 * refuse to start.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const bin = process.argv[2];
if (!bin) throw new Error('usage: supervision-pipe.mjs <path to avoir-server>');

/** Start a backend, wait until it reports its port, then close stdin. */
async function run({ supervised }) {
  const env = {
    ...process.env,
    AVOIR_DATA_DIR: mkdtempSync(join(tmpdir(), 'avoir-sup-')),
    AVOIR_TOKEN: `ci-${Math.random().toString(36).slice(2)}`,
  };
  if (supervised) env.AVOIR_SUPERVISED = '1';
  else delete env.AVOIR_SUPERVISED;

  const child = spawn(bin, [], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.on('error', () => {});

  const ready = await new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), 20000);
    child.stdout.once('data', () => {
      clearTimeout(t);
      resolve(true);
    });
  });
  if (!ready) {
    child.kill();
    throw new Error('backend never reported a port');
  }

  child.stdin.end(); // the shell dying, without killing the child

  const exited = await new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), 8000);
    child.on('exit', () => {
      clearTimeout(t);
      resolve(true);
    });
  });
  if (!exited) child.kill('SIGKILL');
  return exited;
}

const supervised = await run({ supervised: true });
console.log(`supervised, pipe closed -> ${supervised ? 'exited' : 'STILL RUNNING'}`);

const unsupervised = await run({ supervised: false });
console.log(`unsupervised, pipe closed -> ${unsupervised ? 'EXITED' : 'still running'}`);

if (!supervised) {
  console.error(
    '::error::the backend did not exit when the shell pipe closed - it would orphan and hold the database lock',
  );
  process.exit(1);
}
if (unsupervised) {
  console.error(
    '::error::the backend exited without being supervised - a terminal or CI run would die on startup',
  );
  process.exit(1);
}
console.log('both directions correct');
