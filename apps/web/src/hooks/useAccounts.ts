import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';

export const useAccounts = () =>
  useQuery({ queryKey: ['accounts'], queryFn: () => api.accounts.list() });
