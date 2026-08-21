import { HookRegistry } from './hook-registry.js';
import { TransactionLifecycleManager } from './manager.js';
import { systemBudgetHook } from './hooks/system-budget.hook.js';
import { balanceHook } from './hooks/balance.hook.js';
import { scheduleMatcherHook } from './hooks/schedule-matcher.hook.js';
import { tradeHoldingHook } from './hooks/trade-holding.hook.js';
import { bitcoinHoldingHook } from './hooks/bitcoin-holding.hook.js';
import { debtPaymentHook } from './hooks/debt-payment.hook.js';
import { payPeriodHook } from './hooks/pay-period.hook.js';
import { snapshotHook } from './hooks/snapshot.hook.js';

export { HookRegistry } from './hook-registry.js';
export { TransactionLifecycleManager } from './manager.js';
export type { HookContext, HookDefinition, LifecycleEvent, TransactionRecord } from './types.js';
export { ledgerUpdate, ledgerUpdateMany, ledgerCreate, ledgerDelete } from './ledger.js';
export type { LedgerUpdateData, LedgerCreateData, LedgerDeleteContext } from './ledger.js';

export function createLifecycleManager(): TransactionLifecycleManager {
  const registry = new HookRegistry();
  // Register all hooks in priority order
  registry.register(systemBudgetHook); // priority 5
  registry.register(balanceHook); // priority 10
  registry.register(scheduleMatcherHook); // priority 15
  registry.register(tradeHoldingHook); // priority 20
  registry.register(bitcoinHoldingHook); // priority 20
  registry.register(debtPaymentHook); // priority 30
  registry.register(payPeriodHook); // priority 40
  registry.register(snapshotHook); // priority 50
  return new TransactionLifecycleManager(registry);
}
