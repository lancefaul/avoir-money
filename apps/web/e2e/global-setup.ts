import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Playwright global setup — runs once before all e2e tests.
 *
 * Local: Clones reference data from prod DB to test DB, then ensures schema is current.
 * CI: Skips the prod clone (no prod DB available) — migrations already applied by CI pipeline.
 */
export default function globalSetup() {
  // In CI, migrations are already applied by the test job.
  // Skip the Docker-dependent clone script.
  if (process.env.CI) {
    console.log(
      '\n[global-setup] CI environment detected — skipping prod clone, migrations already applied.\n',
    );
    return;
  }

  const scriptPath = path.resolve(__dirname, 'scripts', 'clone-prod-to-test.sh');
  // Run from packages/db so npx prisma resolves correctly
  const cwd = path.resolve(__dirname, '..', '..', '..', 'packages', 'db');
  console.log('\n[global-setup] Cloning prod reference data to test DB...\n');

  try {
    execSync(`bash "${scriptPath}"`, {
      stdio: 'inherit',
      cwd,
      env: { ...process.env },
    });
  } catch (err) {
    console.error('[global-setup] Failed to set up test DB. Are both Docker containers running?');
    throw err;
  }
}
