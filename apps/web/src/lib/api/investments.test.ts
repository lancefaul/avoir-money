import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
} from '@budget-tracker/core';

vi.mock('./request.js', () => ({
  request: vi.fn().mockResolvedValue(undefined),
  _passthrough: { parse: (v: unknown) => v },
}));

import { request, _passthrough } from './request.js';
import { PriceResponseSchema } from '@budget-tracker/core';
import { investmentsApi } from './investments.js';

const mockRequest = vi.mocked(request);

beforeEach(() => {
  mockRequest.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('investmentsApi', () => {
  describe('list', () => {
    it('calls request with GET /investments and list schema', async () => {
      await investmentsApi.list();
      expect(mockRequest).toHaveBeenCalledWith('/investments', InvestmentHoldingListResponseSchema);
    });
  });

  describe('create', () => {
    it('calls request with POST /investments and body', async () => {
      const body = { ticker: 'AAPL', shares: 10, custodianId: 'c1' };
      await investmentsApi.create(body);
      expect(mockRequest).toHaveBeenCalledWith('/investments', InvestmentHoldingResponseSchema, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    });
  });

  describe('update', () => {
    it('calls request with PUT /investments/:id and body', async () => {
      const body = { shares: 20 };
      await investmentsApi.update('h1', body);
      expect(mockRequest).toHaveBeenCalledWith('/investments/h1', InvestmentHoldingResponseSchema, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
    });
  });

  describe('deleteHolding', () => {
    it('calls request with DELETE /investments/:id', async () => {
      await investmentsApi.deleteHolding('h1');
      expect(mockRequest).toHaveBeenCalledWith('/investments/h1', _passthrough, {
        method: 'DELETE',
      });
    });
  });

  describe('snapshot', () => {
    it('calls request with POST /investments/:id/snapshot and body', async () => {
      const body = { price: 150.5, date: '2024-01-15' };
      await investmentsApi.snapshot('h1', body);
      expect(mockRequest).toHaveBeenCalledWith(
        '/investments/h1/snapshot',
        InvestmentSnapshotResponseSchema,
        { method: 'POST', body: JSON.stringify(body) },
      );
    });
  });

  describe('prices', () => {
    it('validates the prices response instead of passing it through', async () => {
      // Typed deliberately: the response shape changed once already, and a
      // passthrough schema let that through as undefined prices at runtime
      // rather than as a compile error.
      await investmentsApi.prices();
      expect(mockRequest).toHaveBeenCalledWith('/investments/prices', PriceResponseSchema);
    });
  });

  describe('history', () => {
    it('calls request with GET /investments/history when no params', async () => {
      await investmentsApi.history();
      expect(mockRequest).toHaveBeenCalledWith('/investments/history', HistoryResponseSchema);
    });

    it('appends query params to URL', async () => {
      await investmentsApi.history({ type: 'TRADE', assetType: 'STOCK', limit: 20, cursor: 'abc' });
      const url = mockRequest.mock.calls[0]![0] as string;
      expect(url).toContain('/investments/history?');
      expect(url).toContain('type=TRADE');
      expect(url).toContain('assetType=STOCK');
      expect(url).toContain('limit=20');
      expect(url).toContain('cursor=abc');
    });

    it('omits undefined/null params from query string', async () => {
      await investmentsApi.history({ type: 'TRANSFER', assetType: undefined, limit: undefined });
      const url = mockRequest.mock.calls[0]![0] as string;
      expect(url).toContain('type=TRANSFER');
      expect(url).not.toContain('assetType');
      expect(url).not.toContain('limit');
    });

    it('uses HistoryResponseSchema', async () => {
      await investmentsApi.history({ type: 'PAYMENT' });
      expect(mockRequest).toHaveBeenCalledWith(
        expect.stringContaining('/investments/history'),
        HistoryResponseSchema,
      );
    });
  });

  describe('custodians', () => {
    describe('list', () => {
      it('calls request with GET /investments/custodians', async () => {
        await investmentsApi.custodians.list();
        expect(mockRequest).toHaveBeenCalledWith(
          '/investments/custodians',
          CustodianListResponseSchema,
        );
      });
    });

    describe('create', () => {
      it('calls request with POST /investments/custodians and body', async () => {
        const body = { name: 'Fidelity' };
        await investmentsApi.custodians.create(body);
        expect(mockRequest).toHaveBeenCalledWith(
          '/investments/custodians',
          CustodianResponseSchema,
          { method: 'POST', body: JSON.stringify(body) },
        );
      });
    });

    describe('update', () => {
      it('calls request with PUT /investments/custodians/:id and body', async () => {
        const body = { name: 'Vanguard' };
        await investmentsApi.custodians.update('c1', body);
        expect(mockRequest).toHaveBeenCalledWith(
          '/investments/custodians/c1',
          CustodianResponseSchema,
          { method: 'PUT', body: JSON.stringify(body) },
        );
      });
    });

    describe('delete', () => {
      it('calls request with DELETE /investments/custodians/:id', async () => {
        await investmentsApi.custodians.delete('c1');
        expect(mockRequest).toHaveBeenCalledWith('/investments/custodians/c1', _passthrough, {
          method: 'DELETE',
        });
      });
    });
  });

  describe('wallets', () => {
    describe('list', () => {
      it('calls request with GET /investments/wallets', async () => {
        await investmentsApi.wallets.list();
        expect(mockRequest).toHaveBeenCalledWith('/investments/wallets', WalletListResponseSchema);
      });
    });

    describe('create', () => {
      it('calls request with POST /investments/wallets and body', async () => {
        const body = { name: 'Ledger', type: 'HARDWARE' };
        await investmentsApi.wallets.create(body);
        expect(mockRequest).toHaveBeenCalledWith('/investments/wallets', WalletResponseSchema, {
          method: 'POST',
          body: JSON.stringify(body),
        });
      });
    });

    describe('update', () => {
      it('calls request with PUT /investments/wallets/:id and body', async () => {
        const body = { name: 'Trezor' };
        await investmentsApi.wallets.update('w1', body);
        expect(mockRequest).toHaveBeenCalledWith('/investments/wallets/w1', WalletResponseSchema, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
      });
    });

    describe('delete', () => {
      it('calls request with DELETE /investments/wallets/:id', async () => {
        await investmentsApi.wallets.delete('w1');
        expect(mockRequest).toHaveBeenCalledWith('/investments/wallets/w1', _passthrough, {
          method: 'DELETE',
        });
      });
    });
  });

  describe('transferBitcoin', () => {
    it('calls request with POST /investments/transfers/bitcoin and body', async () => {
      const body = { fromWalletId: 'w1', toWalletId: 'w2', amount: 0.5 };
      await investmentsApi.transferBitcoin(body);
      expect(mockRequest).toHaveBeenCalledWith(
        '/investments/transfers/bitcoin',
        BitcoinTransferResponseSchema,
        { method: 'POST', body: JSON.stringify(body) },
      );
    });
  });

  describe('transferStock', () => {
    it('calls request with POST /investments/transfers/stock and body', async () => {
      const body = { fromHoldingId: 'h1', toHoldingId: 'h2', shares: 5 };
      await investmentsApi.transferStock(body);
      expect(mockRequest).toHaveBeenCalledWith(
        '/investments/transfers/stock',
        StockTransferResponseSchema,
        { method: 'POST', body: JSON.stringify(body) },
      );
    });
  });

  describe('deleteTransfer', () => {
    it('calls request with DELETE /investments/transfers/:id', async () => {
      await investmentsApi.deleteTransfer('t1');
      expect(mockRequest).toHaveBeenCalledWith('/investments/transfers/t1', _passthrough, {
        method: 'DELETE',
      });
    });
  });

  describe('portfolioHistory', () => {
    it('calls request with GET /investments/portfolio-history when no period', async () => {
      await investmentsApi.portfolioHistory();
      expect(mockRequest).toHaveBeenCalledWith(
        '/investments/portfolio-history',
        PortfolioHistoryResponseSchema,
      );
    });

    it('appends period query param', async () => {
      await investmentsApi.portfolioHistory('1M');
      expect(mockRequest).toHaveBeenCalledWith(
        '/investments/portfolio-history?period=1M',
        PortfolioHistoryResponseSchema,
      );
    });

    it('supports ALL period', async () => {
      await investmentsApi.portfolioHistory('ALL');
      expect(mockRequest).toHaveBeenCalledWith(
        '/investments/portfolio-history?period=ALL',
        PortfolioHistoryResponseSchema,
      );
    });
  });
});
