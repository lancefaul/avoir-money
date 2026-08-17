import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { createWrapper } from '../test/wrapper.js';

function createTestWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return { wrapper, queryClient };
}

const mockList = vi.fn().mockResolvedValue([{ id: '1', symbol: 'AAPL' }]);
const mockPrices = vi.fn().mockResolvedValue([{ symbol: 'AAPL', price: 150 }]);
const mockUpdate = vi.fn().mockResolvedValue({ id: '1', symbol: 'AAPL' });
const mockTransferBitcoin = vi.fn().mockResolvedValue({ id: 'tx_1' });
const mockTransferStock = vi.fn().mockResolvedValue({ id: 'tx_2' });
const mockDeleteHolding = vi.fn().mockResolvedValue(undefined);
const mockPortfolioHistory = vi.fn().mockResolvedValue({ points: [] });
const mockHistory = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
const mockCustodiansList = vi.fn().mockResolvedValue([{ id: 'c1', name: 'Fidelity' }]);
const mockCustodiansCreate = vi.fn().mockResolvedValue({ id: 'c2', name: 'Schwab' });
const mockCustodiansUpdate = vi.fn().mockResolvedValue({ id: 'c1', name: 'Updated' });
const mockCustodiansDelete = vi.fn().mockResolvedValue(undefined);
const mockWalletsList = vi.fn().mockResolvedValue([{ id: 'w1', name: 'Ledger' }]);
const mockWalletsCreate = vi.fn().mockResolvedValue({ id: 'w2', name: 'Trezor' });
const mockWalletsUpdate = vi.fn().mockResolvedValue({ id: 'w1', name: 'Updated' });
const mockWalletsDelete = vi.fn().mockResolvedValue(undefined);

vi.mock('../lib/api.js', () => ({
  api: {
    investments: {
      list: (...args: unknown[]) => mockList(...args),
      prices: (...args: unknown[]) => mockPrices(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
      transferBitcoin: (...args: unknown[]) => mockTransferBitcoin(...args),
      transferStock: (...args: unknown[]) => mockTransferStock(...args),
      deleteHolding: (...args: unknown[]) => mockDeleteHolding(...args),
      portfolioHistory: (...args: unknown[]) => mockPortfolioHistory(...args),
      history: (...args: unknown[]) => mockHistory(...args),
      custodians: {
        list: (...args: unknown[]) => mockCustodiansList(...args),
        create: (...args: unknown[]) => mockCustodiansCreate(...args),
        update: (...args: unknown[]) => mockCustodiansUpdate(...args),
        delete: (...args: unknown[]) => mockCustodiansDelete(...args),
      },
      wallets: {
        list: (...args: unknown[]) => mockWalletsList(...args),
        create: (...args: unknown[]) => mockWalletsCreate(...args),
        update: (...args: unknown[]) => mockWalletsUpdate(...args),
        delete: (...args: unknown[]) => mockWalletsDelete(...args),
      },
    },
  },
}));

import {
  useInvestments,
  useInvestmentPrices,
  useUpdateInvestment,
  useBitcoinTransfer,
  useStockTransfer,
  useDeleteHolding,
  usePortfolioHistory,
  useInvestmentHistory,
  useCustodians,
  useCreateCustodian,
  useUpdateCustodian,
  useDeleteCustodian,
  useWallets,
  useCreateWallet,
  useUpdateWallet,
  useDeleteWallet,
} from './useInvestments.js';

describe('useInvestments hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('query hooks', () => {
    it('useInvestments fetches investment list', async () => {
      const { result } = renderHook(() => useInvestments(), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockList).toHaveBeenCalled();
      expect(result.current.data).toEqual([{ id: '1', symbol: 'AAPL' }]);
    });

    it('useInvestmentPrices fetches prices', async () => {
      const { result } = renderHook(() => useInvestmentPrices(), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockPrices).toHaveBeenCalled();
      expect(result.current.data).toEqual([{ symbol: 'AAPL', price: 150 }]);
    });

    it('usePortfolioHistory passes period to API', async () => {
      const { result } = renderHook(() => usePortfolioHistory('1M'), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockPortfolioHistory).toHaveBeenCalledWith('1M');
    });

    it('usePortfolioHistory defaults to ALL', async () => {
      const { result } = renderHook(() => usePortfolioHistory(), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockPortfolioHistory).toHaveBeenCalledWith('ALL');
    });

    it('useCustodians fetches custodian list', async () => {
      const { result } = renderHook(() => useCustodians(), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockCustodiansList).toHaveBeenCalled();
      expect(result.current.data).toEqual([{ id: 'c1', name: 'Fidelity' }]);
    });

    it('useWallets fetches wallet list', async () => {
      const { result } = renderHook(() => useWallets(), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockWalletsList).toHaveBeenCalled();
      expect(result.current.data).toEqual([{ id: 'w1', name: 'Ledger' }]);
    });

    it('useInvestmentHistory passes type and assetType filters', async () => {
      const { result } = renderHook(() => useInvestmentHistory('TRADE', 'STOCK'), {
        wrapper: createWrapper(),
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockHistory).toHaveBeenCalledWith({
        type: 'TRADE',
        assetType: 'STOCK',
        cursor: undefined,
      });
    });
  });

  describe('mutation API delegation', () => {
    it('useUpdateInvestment calls api.investments.update', async () => {
      const { wrapper } = createTestWrapper();
      const { result } = renderHook(() => useUpdateInvestment(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 'inv_1', body: { symbol: 'GOOG' } });
      });

      expect(mockUpdate).toHaveBeenCalledWith('inv_1', { symbol: 'GOOG' });
    });

    it('useBitcoinTransfer calls api.investments.transferBitcoin', async () => {
      const { wrapper } = createTestWrapper();
      const { result } = renderHook(() => useBitcoinTransfer(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ fromWallet: 'w1', toWallet: 'w2', amount: 0.5 });
      });

      expect(mockTransferBitcoin).toHaveBeenCalledWith({
        fromWallet: 'w1',
        toWallet: 'w2',
        amount: 0.5,
      });
    });

    it('useStockTransfer calls api.investments.transferStock', async () => {
      const { wrapper } = createTestWrapper();
      const { result } = renderHook(() => useStockTransfer(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ fromCustodian: 'c1', toCustodian: 'c2', shares: 10 });
      });

      expect(mockTransferStock).toHaveBeenCalledWith({
        fromCustodian: 'c1',
        toCustodian: 'c2',
        shares: 10,
      });
    });

    it('useDeleteHolding calls api.investments.deleteHolding', async () => {
      const { wrapper } = createTestWrapper();
      const { result } = renderHook(() => useDeleteHolding(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('inv_1');
      });

      expect(mockDeleteHolding).toHaveBeenCalledWith('inv_1');
    });

    it('useCreateCustodian calls api.investments.custodians.create', async () => {
      const { wrapper } = createTestWrapper();
      const { result } = renderHook(() => useCreateCustodian(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ name: 'Schwab' });
      });

      expect(mockCustodiansCreate).toHaveBeenCalledWith({ name: 'Schwab' });
    });

    it('useUpdateCustodian calls api.investments.custodians.update', async () => {
      const { wrapper } = createTestWrapper();
      const { result } = renderHook(() => useUpdateCustodian(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 'c1', body: { name: 'Updated' } });
      });

      expect(mockCustodiansUpdate).toHaveBeenCalledWith('c1', { name: 'Updated' });
    });

    it('useDeleteCustodian calls api.investments.custodians.delete', async () => {
      const { wrapper } = createTestWrapper();
      const { result } = renderHook(() => useDeleteCustodian(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('c1');
      });

      expect(mockCustodiansDelete).toHaveBeenCalledWith('c1');
    });

    it('useCreateWallet calls api.investments.wallets.create', async () => {
      const { wrapper } = createTestWrapper();
      const { result } = renderHook(() => useCreateWallet(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ name: 'Trezor' });
      });

      expect(mockWalletsCreate).toHaveBeenCalledWith({ name: 'Trezor' });
    });

    it('useUpdateWallet calls api.investments.wallets.update', async () => {
      const { wrapper } = createTestWrapper();
      const { result } = renderHook(() => useUpdateWallet(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 'w1', body: { name: 'Updated' } });
      });

      expect(mockWalletsUpdate).toHaveBeenCalledWith('w1', { name: 'Updated' });
    });

    it('useDeleteWallet calls api.investments.wallets.delete', async () => {
      const { wrapper } = createTestWrapper();
      const { result } = renderHook(() => useDeleteWallet(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('w1');
      });

      expect(mockWalletsDelete).toHaveBeenCalledWith('w1');
    });
  });

  describe('cache invalidation', () => {
    it('useUpdateInvestment invalidates investments and investment-history', async () => {
      const { wrapper, queryClient } = createTestWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useUpdateInvestment(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: '1', body: { symbol: 'GOOG' } });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['investments'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['investment-history'] });
    });

    it('useBitcoinTransfer invalidates investments, investment-history, transactions, accounts', async () => {
      const { wrapper, queryClient } = createTestWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useBitcoinTransfer(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ fromWallet: 'w1', toWallet: 'w2', amount: 0.5 });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['investments'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['investment-history'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['transactions'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['accounts'] });
    });

    it('useStockTransfer invalidates investments, investment-history, transactions, accounts', async () => {
      const { wrapper, queryClient } = createTestWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useStockTransfer(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ fromCustodian: 'c1', toCustodian: 'c2', shares: 10 });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['investments'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['investment-history'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['transactions'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['accounts'] });
    });

    it('useDeleteHolding invalidates investments and investment-history', async () => {
      const { wrapper, queryClient } = createTestWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useDeleteHolding(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('inv_1');
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['investments'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['investment-history'] });
    });

    it('useCreateCustodian invalidates custodians', async () => {
      const { wrapper, queryClient } = createTestWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useCreateCustodian(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ name: 'Schwab' });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['custodians'] });
    });

    it('useUpdateCustodian invalidates custodians', async () => {
      const { wrapper, queryClient } = createTestWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useUpdateCustodian(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 'c1', body: { name: 'Updated' } });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['custodians'] });
    });

    it('useDeleteCustodian invalidates custodians', async () => {
      const { wrapper, queryClient } = createTestWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useDeleteCustodian(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('c1');
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['custodians'] });
    });

    it('useCreateWallet invalidates wallets', async () => {
      const { wrapper, queryClient } = createTestWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useCreateWallet(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ name: 'Trezor' });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['wallets'] });
    });

    it('useUpdateWallet invalidates wallets', async () => {
      const { wrapper, queryClient } = createTestWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useUpdateWallet(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 'w1', body: { name: 'Updated' } });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['wallets'] });
    });

    it('useDeleteWallet invalidates wallets', async () => {
      const { wrapper, queryClient } = createTestWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const { result } = renderHook(() => useDeleteWallet(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('w1');
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['wallets'] });
    });
  });

  describe('mutation meta', () => {
    it('useUpdateInvestment has correct successMessage', async () => {
      const { wrapper, queryClient } = createTestWrapper();
      const { result } = renderHook(() => useUpdateInvestment(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: '1', body: { symbol: 'GOOG' } });
      });

      const mutations = queryClient.getMutationCache().getAll();
      const lastMutation = mutations[mutations.length - 1];
      expect(lastMutation?.options.meta).toMatchObject({ successMessage: 'Investment updated' });
    });

    it('useBitcoinTransfer has correct successMessage', async () => {
      const { wrapper, queryClient } = createTestWrapper();
      const { result } = renderHook(() => useBitcoinTransfer(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ fromWallet: 'w1', toWallet: 'w2', amount: 0.5 });
      });

      const mutations = queryClient.getMutationCache().getAll();
      const lastMutation = mutations[mutations.length - 1];
      expect(lastMutation?.options.meta).toMatchObject({ successMessage: 'Bitcoin transferred' });
    });

    it('useStockTransfer has correct successMessage', async () => {
      const { wrapper, queryClient } = createTestWrapper();
      const { result } = renderHook(() => useStockTransfer(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ fromCustodian: 'c1', toCustodian: 'c2', shares: 10 });
      });

      const mutations = queryClient.getMutationCache().getAll();
      const lastMutation = mutations[mutations.length - 1];
      expect(lastMutation?.options.meta).toMatchObject({ successMessage: 'Stock transferred' });
    });

    it('useDeleteHolding has correct successMessage', async () => {
      const { wrapper, queryClient } = createTestWrapper();
      const { result } = renderHook(() => useDeleteHolding(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('inv_1');
      });

      const mutations = queryClient.getMutationCache().getAll();
      const lastMutation = mutations[mutations.length - 1];
      expect(lastMutation?.options.meta).toMatchObject({ successMessage: 'Holding deleted' });
    });

    it('useCreateCustodian has correct successMessage', async () => {
      const { wrapper, queryClient } = createTestWrapper();
      const { result } = renderHook(() => useCreateCustodian(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ name: 'Schwab' });
      });

      const mutations = queryClient.getMutationCache().getAll();
      const lastMutation = mutations[mutations.length - 1];
      expect(lastMutation?.options.meta).toMatchObject({ successMessage: 'Custodian created' });
    });

    it('useUpdateCustodian has correct successMessage', async () => {
      const { wrapper, queryClient } = createTestWrapper();
      const { result } = renderHook(() => useUpdateCustodian(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 'c1', body: { name: 'Updated' } });
      });

      const mutations = queryClient.getMutationCache().getAll();
      const lastMutation = mutations[mutations.length - 1];
      expect(lastMutation?.options.meta).toMatchObject({ successMessage: 'Custodian updated' });
    });

    it('useDeleteCustodian has correct successMessage', async () => {
      const { wrapper, queryClient } = createTestWrapper();
      const { result } = renderHook(() => useDeleteCustodian(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('c1');
      });

      const mutations = queryClient.getMutationCache().getAll();
      const lastMutation = mutations[mutations.length - 1];
      expect(lastMutation?.options.meta).toMatchObject({ successMessage: 'Custodian deleted' });
    });

    it('useCreateWallet has correct successMessage', async () => {
      const { wrapper, queryClient } = createTestWrapper();
      const { result } = renderHook(() => useCreateWallet(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ name: 'Trezor' });
      });

      const mutations = queryClient.getMutationCache().getAll();
      const lastMutation = mutations[mutations.length - 1];
      expect(lastMutation?.options.meta).toMatchObject({ successMessage: 'Wallet created' });
    });

    it('useUpdateWallet has correct successMessage', async () => {
      const { wrapper, queryClient } = createTestWrapper();
      const { result } = renderHook(() => useUpdateWallet(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 'w1', body: { name: 'Updated' } });
      });

      const mutations = queryClient.getMutationCache().getAll();
      const lastMutation = mutations[mutations.length - 1];
      expect(lastMutation?.options.meta).toMatchObject({ successMessage: 'Wallet updated' });
    });

    it('useDeleteWallet has correct successMessage', async () => {
      const { wrapper, queryClient } = createTestWrapper();
      const { result } = renderHook(() => useDeleteWallet(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('w1');
      });

      const mutations = queryClient.getMutationCache().getAll();
      const lastMutation = mutations[mutations.length - 1];
      expect(lastMutation?.options.meta).toMatchObject({ successMessage: 'Wallet deleted' });
    });
  });
});
