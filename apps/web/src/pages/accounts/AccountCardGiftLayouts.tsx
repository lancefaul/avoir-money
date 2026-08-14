import { formatCurrency, cn } from '../../lib/utils.js';
import * as s from './account-card.css.js';
import { ActionButtons, type AccountCardProps } from './AccountCardActions.js';

/* Gift-card brand layouts (generic barcode, Apple, Costco, Amazon), extracted
   from AccountCard.tsx. */

/* ── Gift Card ── */

export function GiftCardLayout({
  account,
  onEdit,
  onDelete,
  onToggleArchive,
  onReconcile,
  onHide,
  isHidden,
  onLedger,
}: AccountCardProps) {
  const { name, balance, archived } = account;

  // Generate barcode pattern — alternating bars and spaces spanning full width
  const barcodePattern = Array.from({ length: 60 }, (_, i) => {
    const seed = (name.charCodeAt(i % name.length) * 7 + i * 13) & 0xff;
    const isBar = i % 2 === 0;
    const width = isBar
      ? seed % 4 === 0
        ? 4
        : seed % 3 === 0
          ? 3
          : seed % 2 === 0
            ? 2
            : 1
      : seed % 3 === 0
        ? 3
        : seed % 2 === 0
          ? 2
          : 1;
    return { isBar, width };
  });

  return (
    <div className={cn(s.cardBase, s.cardGiftCard, archived && s.cardArchived)}>
      <ActionButtons
        account={account}
        onEdit={onEdit}
        onDelete={onDelete}
        onToggleArchive={onToggleArchive}
        onReconcile={onReconcile}
        onHide={onHide}
        isHidden={isHidden}
        onLedger={onLedger}
      />

      {/* Name — top left */}
      <div className={s.cardNameGift}>{name}</div>

      {/* Spacer */}
      <div className={s.giftSpacer} />

      {/* Barcode */}
      <div className={s.barcode}>
        {/* key={i} acceptable: static array derived from account name, never reordered */}
        {barcodePattern.map((b, i) => (
          <div
            key={i}
            style={{ flex: b.width, background: b.isBar ? 'currentColor' : 'transparent' }}
          />
        ))}
      </div>

      {/* Spacer */}
      <div className={s.giftSpacer} />

      {/* Balance — bottom left */}
      <span className={s.balanceGift}>{formatCurrency(balance)}</span>
    </div>
  );
}

/* ── Apple Gift Card ── */

export function AppleGiftCardLayout({
  account,
  onEdit,
  onDelete,
  onToggleArchive,
  onReconcile,
  onHide,
  isHidden,
  onLedger,
}: AccountCardProps) {
  const { balance, archived } = account;

  return (
    <div className={cn(s.cardBase, s.cardApple, archived && s.cardArchived)}>
      <ActionButtons
        account={account}
        onEdit={onEdit}
        onDelete={onDelete}
        onToggleArchive={onToggleArchive}
        onReconcile={onReconcile}
        onHide={onHide}
        isHidden={isHidden}
        onLedger={onLedger}
      />

      {/* Centered Apple gift card logo */}
      <img src="/apple-gift-card-logo.png" alt="Apple" className={s.appleLogo} />

      {/* Balance — bottom left */}
      <div className={s.appleBottom}>
        <span className={s.appleBalanceRow}>{formatCurrency(balance)}</span>
      </div>
    </div>
  );
}

/* ── Costco Gift Card ── */

export function CostcoGiftCardLayout({
  account,
  onEdit,
  onDelete,
  onToggleArchive,
  onReconcile,
  onHide,
  isHidden,
  onLedger,
}: AccountCardProps) {
  const { balance, archived } = account;

  return (
    <div className={cn(s.cardBase, s.cardApple, archived && s.cardArchived)}>
      <ActionButtons
        account={account}
        onEdit={onEdit}
        onDelete={onDelete}
        onToggleArchive={onToggleArchive}
        onReconcile={onReconcile}
        onHide={onHide}
        isHidden={isHidden}
        onLedger={onLedger}
      />

      {/* Centered Costco logo */}
      <img src="/costco-logo.svg" alt="Costco" className={s.costcoLogo} />

      {/* Balance — bottom left */}
      <div className={s.appleBottom}>
        <span className={s.appleBalanceRow}>{formatCurrency(balance)}</span>
      </div>
    </div>
  );
}

/* ── Amazon Gift Card ── */

export function AmazonGiftCardLayout({
  account,
  onEdit,
  onDelete,
  onToggleArchive,
  onReconcile,
  onHide,
  isHidden,
  onLedger,
}: AccountCardProps) {
  const { balance, archived } = account;

  return (
    <div className={cn(s.cardBase, s.cardAmazon, archived && s.cardArchived)}>
      <ActionButtons
        account={account}
        onEdit={onEdit}
        onDelete={onDelete}
        onToggleArchive={onToggleArchive}
        onReconcile={onReconcile}
        onHide={onHide}
        isHidden={isHidden}
        onLedger={onLedger}
        onDark
      />

      {/* Amazon logo — top left (white text, orange smile) */}
      <img src="/amazon-logo-white.svg" alt="Amazon" className={s.amazonLogo} />

      {/* Large decorative smile — centered */}
      <img src="/amazon-smile.svg" alt="" aria-hidden="true" className={s.amazonSmile} />

      {/* Bottom: balance */}
      <div className={s.amazonBottom}>
        <span className={s.amazonBalanceRow}>{formatCurrency(balance)}</span>
      </div>
    </div>
  );
}
