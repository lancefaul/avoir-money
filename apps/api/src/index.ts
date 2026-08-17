import { serve } from '@hono/node-server';
import app from './app.js';
import { rescheduleBackups } from './lib/backup-scheduler.js';

const port = Number(process.env['PORT']) || 3001;

serve({ fetch: app.fetch, hostname: '0.0.0.0', port }, () => {
  console.log(`Avoir Money API running on http://0.0.0.0:${port}`);
  console.log(`OpenAPI spec: http://localhost:${port}/api/v1/openapi.json`);

  // Start backup scheduler after server is up
  rescheduleBackups().catch((err) => {
    console.error('[backup-scheduler] Failed to initialize:', err);
  });
});
