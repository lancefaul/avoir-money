/**
 * Serialization helpers for reconciliation records.
 *
 * Kept out of the route files so the handlers stay thin (validate → write →
 * serialize → respond) and so both route files share one definition.
 */

import type {
  ReconciliationSession,
  ReconciliationMatchRecord,
  StatementRowRecord,
} from '@budget-tracker/core';

interface DecimalLike {
  toNumber(): number;
}

export interface SessionRow {
  id: string;
  accountId: string;
  periodStart: Date;
  periodEnd: Date;
  statementEndingBalance: DecimalLike;
  status: string;
  residualAtClose: DecimalLike;
  reconciledAt: Date | null;
  adjustmentTransactionId: string | null;
  adjustmentReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function serializeSession(s: SessionRow): ReconciliationSession {
  return {
    id: s.id,
    accountId: s.accountId,
    periodStart: s.periodStart,
    periodEnd: s.periodEnd,
    statementEndingBalance: s.statementEndingBalance.toNumber(),
    status: s.status as ReconciliationSession['status'],
    residualAtClose: s.residualAtClose.toNumber(),
    reconciledAt: s.reconciledAt,
    adjustmentTransactionId: s.adjustmentTransactionId,
    adjustmentReason: s.adjustmentReason,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

export interface StatementRowRecordInput {
  id: string;
  sessionId: string;
  postedDate: Date;
  transactionDate: Date;
  description: string;
  amount: DecimalLike;
  rawLine: string;
  createdAt: Date;
}

export function serializeStatementRow(r: StatementRowRecordInput): StatementRowRecord {
  return {
    id: r.id,
    sessionId: r.sessionId,
    postedDate: r.postedDate,
    transactionDate: r.transactionDate,
    description: r.description,
    amount: r.amount.toNumber(),
    rawLine: r.rawLine,
    createdAt: r.createdAt,
  };
}

export interface MatchRowInput {
  id: string;
  sessionId: string;
  statementRowId: string;
  transactionId: string;
  matchType: string;
  createdAt: Date;
}

export function serializeMatch(m: MatchRowInput): ReconciliationMatchRecord {
  return {
    id: m.id,
    sessionId: m.sessionId,
    statementRowId: m.statementRowId,
    transactionId: m.transactionId,
    matchType: m.matchType as ReconciliationMatchRecord['matchType'],
    createdAt: m.createdAt,
  };
}
