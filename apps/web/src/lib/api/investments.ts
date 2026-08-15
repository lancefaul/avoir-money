import { request, _passthrough } from './request.js';
import {
  InvestmentHoldingResponseSchema,
  InvestmentHoldingListResponseSchema,
  InvestmentSnapshotResponseSchema,
  CustodianResponseSchema,
  CustodianListResponseSchema,
  WalletResponseSchema,
  WalletListResponseSchema,
  BitcoinTransferResponseSchema,
  StockTransferResponseSchema,
  HistoryResponseSchema,
  PortfolioHistoryResponseSchema,
  PriceResponseSchema,
} from '@budget-tracker/core';

export const investmentsApi = {
  list: () => request('/investments', InvestmentHoldingListResponseSchema),
  create: (body: unknown) =>
    request('/investments', InvestmentHoldingResponseSchema, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  update: (id: string, body: unknown) =>
    request(`/investments/${id}`, InvestmentHoldingResponseSchema, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  snapshot: (id: string, body: unknown) =>
    request(`/investments/${id}/snapshot`, InvestmentSnapshotResponseSchema, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  prices: () => request('/investments/prices', PriceResponseSchema),
  history: (params?: {
    type?: 'TRADE' | 'TRANSFER' | 'PAYMENT';
    assetType?: 'STOCK' | 'BITCOIN';
    limit?: number;
    cursor?: string;
  }) => {
    const entries: Record<string, string> = {};
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) entries[k] = String(v);
      }
    }
    const q = new URLSearchParams(entries).toString();
    return request(`/investments/history${q ? `?${q}` : ''}`, HistoryResponseSchema);
  },
  custodians: {
    list: () => request('/investments/custodians', CustodianListResponseSchema),
    create: (body: unknown) =>
      request('/investments/custodians', CustodianResponseSchema, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (id: string, body: unknown) =>
      request(`/investments/custodians/${id}`, CustodianResponseSchema, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    delete: (id: string) =>
      request(`/investments/custodians/${id}`, _passthrough, { method: 'DELETE' }),
  },
  wallets: {
    list: () => request('/investments/wallets', WalletListResponseSchema),
    create: (body: unknown) =>
      request('/investments/wallets', WalletResponseSchema, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (id: string, body: unknown) =>
      request(`/investments/wallets/${id}`, WalletResponseSchema, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    delete: (id: string) =>
      request(`/investments/wallets/${id}`, _passthrough, { method: 'DELETE' }),
  },
  transferBitcoin: (body: unknown) =>
    request('/investments/transfers/bitcoin', BitcoinTransferResponseSchema, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  transferStock: (body: unknown) =>
    request('/investments/transfers/stock', StockTransferResponseSchema, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deleteTransfer: (id: string) =>
    request(`/investments/transfers/${id}`, _passthrough, { method: 'DELETE' }),
  deleteHolding: (id: string) => request(`/investments/${id}`, _passthrough, { method: 'DELETE' }),
  portfolioHistory: (period?: '1W' | '1M' | '3M' | '6M' | '1Y' | 'ALL') => {
    const q = period ? `?period=${period}` : '';
    return request(`/investments/portfolio-history${q}`, PortfolioHistoryResponseSchema);
  },
  regenerateSnapshots: () =>
    request('/investments/snapshots/regenerate', _passthrough, { method: 'POST' }),
};
