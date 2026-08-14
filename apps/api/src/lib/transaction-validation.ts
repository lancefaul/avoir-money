/**
 * Extracted validation logic for trade and bitcoin-payment transactions.
 * Pure validation — no Hono context dependency, returns discriminated results.
 */
import { prisma } from '@budget-tracker/db';
import { computeUsdAmount } from './holdings.js';

// ─── Result Types ───

type ValidationSuccess<T = void> = { ok: true; data?: T };
type ValidationFailure = { ok: false; error: string; status: 400 | 404 };
type ValidationResult<T = void> = ValidationSuccess<T> | ValidationFailure;

// ─── Parameter Types ───

interface TradeMetadataInput {
  direction: 'BUY' | 'SELL';
  assetType: 'Stock' | 'Bitcoin';
  ticker?: string | null;
  quantity: number;
  bitcoinUnit?: 'Bitcoin' | 'Sats';
  custodianId?: string;
  walletId?: string;
}

interface BitcoinMetadataInput {
  walletId: string;
  quantity: number;
  bitcoinUnit: 'Bitcoin' | 'Sats';
  unitPrice: number;
}

// ─── Validators ───

/**
 * Validate trade metadata for a TRADE transaction.
 *
 * For SELL trades: verifies the custodian/wallet exists and that the user
 * holds enough of the asset to cover the sale quantity.
 * For BUY trades: no validation needed — always succeeds.
 */
export async function validateTradeMetadata(meta: TradeMetadataInput): Promise<ValidationResult> {
  if (meta.direction !== 'SELL') {
    return { ok: true };
  }

  const holdingType = meta.assetType === 'Stock' ? 'STOCK' : 'BITCOIN';
  const ticker = meta.assetType === 'Stock' ? meta.ticker : null;

  if (meta.assetType === 'Stock') {
    const custodian = await prisma.custodian.findUnique({ where: { id: meta.custodianId } });
    if (!custodian) return { ok: false, error: 'Custodian not found', status: 400 };
  } else {
    const wallet = await prisma.wallet.findUnique({ where: { id: meta.walletId } });
    if (!wallet) return { ok: false, error: 'Wallet not found', status: 400 };
  }

  const holding = await prisma.investmentHolding.findFirst({
    where: {
      type: holdingType as 'STOCK' | 'BITCOIN',
      ...(meta.assetType === 'Stock'
        ? { custodianId: meta.custodianId }
        : { walletId: meta.walletId }),
      ...(ticker ? { ticker } : { ticker: null }),
    },
  });

  const currentQty = holding ? Number(holding.quantity) : 0;
  // Normalize quantity to BTC for comparison (holdings are stored in BTC)
  const sellQty =
    meta.assetType === 'Bitcoin' && meta.bitcoinUnit === 'Sats'
      ? meta.quantity / 100_000_000
      : meta.quantity;
  if (sellQty > currentQty) {
    return {
      ok: false,
      error: `Insufficient holdings: have ${currentQty}, trying to sell ${sellQty}`,
      status: 400,
    };
  }

  return { ok: true };
}

/**
 * Validate bitcoin payment metadata for a transaction.
 *
 * Checks that the wallet exists, and for EXPENSE transactions verifies
 * sufficient BTC holdings. On success, returns the computed USD amount.
 */
export async function validateBitcoinPayment(
  btcMeta: BitcoinMetadataInput,
  transactionType: string,
): Promise<ValidationResult<{ usdAmount: number }>> {
  const wallet = await prisma.wallet.findUnique({ where: { id: btcMeta.walletId } });
  if (!wallet) return { ok: false, error: 'Wallet not found', status: 400 };

  if (transactionType === 'EXPENSE') {
    const holding = await prisma.investmentHolding.findFirst({
      where: { type: 'BITCOIN', walletId: btcMeta.walletId, ticker: null },
    });

    const currentQty = holding ? Number(holding.quantity) : 0;
    const spendQty =
      btcMeta.bitcoinUnit === 'Sats' ? btcMeta.quantity / 100_000_000 : btcMeta.quantity;

    if (spendQty > currentQty) {
      return {
        ok: false,
        error: `Insufficient holdings: have ${currentQty}, trying to spend ${spendQty}`,
        status: 400,
      };
    }
  }

  const usdAmount = computeUsdAmount(btcMeta.quantity, btcMeta.bitcoinUnit, btcMeta.unitPrice);

  return { ok: true, data: { usdAmount } };
}
