import { z } from 'zod';
import { request, _passthrough } from './request.js';
import {
  CloseSessionResultSchema,
  ImportStatementResultSchema,
  MergeResultSchema,
  ReconciliationMatchSchema,
  ReconciliationSessionDetailSchema,
  ReconciliationSessionSchema,
  ResidualSchema,
  RunMatchResultSchema,
} from '@budget-tracker/core';

const SessionListSchema = z.array(ReconciliationSessionSchema);
const AdjustmentResultSchema = z.object({
  session: ReconciliationSessionSchema,
  residual: ResidualSchema,
});

/**
 * Refuse to build a URL from an empty id.
 *
 * An empty id splices into `/reconciliations//import`, which the server answers
 * with a bare 404 — indistinguishable from a session that genuinely does not
 * exist, and it sent one debugging session chasing the wrong layer entirely.
 * Failing here names the actual problem.
 */
function requireId(id: string, what: string): string {
  if (!id) throw new Error(`Cannot call ${what}: no reconciliation session id`);
  return id;
}

export const reconciliationsApi = {
  list: (params?: { accountId?: string; status?: string }) => {
    const q = new URLSearchParams();
    if (params?.accountId) q.set('accountId', params.accountId);
    if (params?.status) q.set('status', params.status);
    const qs = q.toString();
    return request(`/reconciliations${qs ? `?${qs}` : ''}`, SessionListSchema);
  },

  get: (id: string) =>
    request(`/reconciliations/${requireId(id, 'get')}`, ReconciliationSessionDetailSchema),

  create: (body: unknown) =>
    request('/reconciliations', ReconciliationSessionSchema, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // Either field may be sent alone: the anchor, the cutoff (periodEnd, an
  // ISO date string), or both. The server requires at least one.
  update: (id: string, body: { statementEndingBalance?: number; periodEnd?: string }) =>
    request(`/reconciliations/${requireId(id, 'update')}`, ReconciliationSessionSchema, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  importStatement: (id: string, csv: string) =>
    request(`/reconciliations/${requireId(id, 'import')}/import`, ImportStatementResultSchema, {
      method: 'POST',
      body: JSON.stringify({ csv }),
    }),

  match: (id: string) =>
    request(`/reconciliations/${requireId(id, 'match')}/match`, RunMatchResultSchema, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  createMatch: (id: string, body: { statementRowId: string; transactionId: string }) =>
    request(`/reconciliations/${requireId(id, 'createMatch')}/matches`, ReconciliationMatchSchema, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  merge: (id: string, body: { statementRowId: string; transactionIds: string[]; name: string }) =>
    request(`/reconciliations/${requireId(id, 'merge')}/merge`, MergeResultSchema, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  deleteMatch: (id: string, matchId: string) =>
    request(`/reconciliations/${requireId(id, 'deleteMatch')}/matches/${matchId}`, _passthrough, {
      method: 'DELETE',
    }),

  close: (id: string) =>
    request(`/reconciliations/${requireId(id, 'close')}/close`, CloseSessionResultSchema, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  adjustment: (id: string, reason: string) =>
    request(`/reconciliations/${requireId(id, 'adjustment')}/adjustment`, AdjustmentResultSchema, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  // Returns only an acknowledgement: abandoning deletes the session, so there is
  // no session left to send back. Passthrough matches deleteMatch, the sibling
  // endpoint with the same { success } shape and an equally unread response.
  abandon: (id: string) =>
    request(`/reconciliations/${requireId(id, 'abandon')}/abandon`, _passthrough, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
};
