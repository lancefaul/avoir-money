import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    fileParallelism: false,
    testTimeout: 15000,
    env: {
      DATABASE_URL: 'postgresql://budget:budget@localhost:5433/budget_tracker_test',
      API_KEY: 'budget-tracker-dev-key',
      NODE_ENV: 'test',
      // Dump validation shells out to a container's pg_restore. --list opens no
      // database, but the default container is the PRODUCTION one, and tests
      // have no business naming it even for a read-only command.
      // Overridable so CI can point at whatever it named its Postgres
      // container — GitHub `services:` generates the name, and these two suites
      // shell out to `docker exec <name> pg_dump`. Local runs keep the default.
      BACKUP_DB_CONTAINER: process.env.BACKUP_DB_CONTAINER ?? 'budget-tracker-db-test',
      BACKUP_DB_NAME: 'budget_tracker_test',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/*.property.test.ts',
        'src/test/**',
        '**/*.d.ts',
        'src/index.ts',
        'src/db-cleanup.ts',
        'src/lib/__tests__/security/**',
        'src/scripts/**',
      ],
      thresholds: { lines: 100 },
    },
  },
});
