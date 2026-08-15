import type { AccountType } from '../types/index.js';

type AccountSeed = {
  name: string;
  type: AccountType;
};

/**
 * Accounts a fresh install starts with, so the app is usable before anything is
 * imported. Generic on purpose: these were the author's own accounts, named
 * after real institutions, which made a seed file a statement about where one
 * person banks. Rename them in the app — nothing depends on these strings.
 */
export const DEFAULT_ACCOUNTS: AccountSeed[] = [
  { name: 'Cash', type: 'CHECKING' },
  { name: 'Checking', type: 'CHECKING' },
  { name: 'Credit Card', type: 'CREDIT_CARD' },
];
