/**
 * Re-export barrel — preserves `import { api } from '../lib/api.js'` for all consumers.
 * Actual implementation lives in `./api/` domain modules.
 */
export { api, ApiValidationError } from './api/index.js';
