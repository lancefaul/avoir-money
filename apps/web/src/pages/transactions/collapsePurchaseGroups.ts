import type { TransactionLogEntry } from '@budget-tracker/core';

export interface PurchaseGroupMeta {
  /** How many accounts funded the purchase. */
  legCount: number;
  /** The funding accounts' ids, for a per-account tooltip/summary. */
  legAccountIds: string[];
}

export interface CollapsedLog {
  entries: TransactionLogEntry[];
  /** Anchor tx id → its group's leg summary (drives the account-count badge). */
  groupMetaByAnchorId: Map<string, PurchaseGroupMeta>;
}

/**
 * Collapse each visible purchase group (payment-split, ADR-030) to a single row —
 * its balance-neutral Anchor — hiding the per-account legs, and annotate the
 * Anchor with how many accounts funded it.
 *
 * A group is collapsed only when its Anchor is present among the entries. In the
 * global transaction log the Anchor is present, so the legs fold into it. In an
 * account-filtered ledger the Anchor (which has no account) is filtered out, so
 * nothing collapses and the account's own leg stays an ordinary row — exactly
 * what that ledger should show. No explicit "am I filtered?" flag is needed.
 */
export function collapsePurchaseGroups(entries: TransactionLogEntry[]): CollapsedLog {
  const anchorIdByGroup = new Map<string, string>();
  const legAccountIdsByGroup = new Map<string, string[]>();
  const legTxIdsByGroup = new Map<string, string[]>();

  for (const e of entries) {
    if (e.kind !== 'transaction') continue;
    const { purchaseGroupId, accountId, id } = e.data;
    if (!purchaseGroupId) continue;
    if (accountId === null) {
      anchorIdByGroup.set(purchaseGroupId, id);
    } else {
      (
        legAccountIdsByGroup.get(purchaseGroupId) ??
        legAccountIdsByGroup.set(purchaseGroupId, []).get(purchaseGroupId)!
      ).push(accountId);
      (
        legTxIdsByGroup.get(purchaseGroupId) ??
        legTxIdsByGroup.set(purchaseGroupId, []).get(purchaseGroupId)!
      ).push(id);
    }
  }

  const hiddenLegIds = new Set<string>();
  const groupMetaByAnchorId = new Map<string, PurchaseGroupMeta>();
  for (const [groupId, anchorId] of anchorIdByGroup) {
    const legAccountIds = legAccountIdsByGroup.get(groupId) ?? [];
    for (const txId of legTxIdsByGroup.get(groupId) ?? []) hiddenLegIds.add(txId);
    groupMetaByAnchorId.set(anchorId, { legCount: legAccountIds.length, legAccountIds });
  }

  const collapsed =
    hiddenLegIds.size === 0
      ? entries
      : entries.filter((e) => e.kind !== 'transaction' || !hiddenLegIds.has(e.data.id));

  return { entries: collapsed, groupMetaByAnchorId };
}
