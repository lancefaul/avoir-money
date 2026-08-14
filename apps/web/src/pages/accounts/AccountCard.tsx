import { Wifi } from 'lucide-react';
import { darkTheme } from '@budget-tracker/ui/theme/theme-dark.css.js';
import { formatCurrency, cn } from '../../lib/utils.js';
import * as s from './account-card.css.js';
import { ActionButtons, type AccountCardProps } from './AccountCardActions.js';
import {
  PrimeVisaLayout,
  XMoneyLayout,
  BanknoteLayout,
  HsaLayout,
  CashAppLayout,
  FidelityLayout,
  CommunityFirstLayout,
  RewardsLine,
} from './AccountCardBrandLayouts.js';
import {
  GiftCardLayout,
  AppleGiftCardLayout,
  CostcoGiftCardLayout,
  AmazonGiftCardLayout,
} from './AccountCardGiftLayouts.js';

/**
 * Card art by brand. One entry per design the app supports.
 *
 * A value here means "this design exists", never "someone holds this account" —
 * which is exactly the distinction the old name-matching could not express.
 */
const BRAND_LAYOUTS: Partial<Record<string, typeof XMoneyLayout>> = {
  X_MONEY: XMoneyLayout,
  PRIME_VISA: PrimeVisaLayout,
  CASH_APP: CashAppLayout,
  COMMUNITY_FIRST: CommunityFirstLayout,
  FIDELITY: FidelityLayout,
  AMAZON_GIFT: AmazonGiftCardLayout,
  APPLE_GIFT: AppleGiftCardLayout,
  COSTCO_GIFT: CostcoGiftCardLayout,
};

export default function AccountCard({
  account,
  onEdit,
  onDelete,
  onToggleArchive,
  onReconcile,
  onHide,
  isHidden,
  onLedger,
  rewardsAccount,
  onRewardsRowClick,
  onEarnRewards,
  onAdjustRewards,
  onAddRewardsAccount,
}: AccountCardProps) {
  /*
   * Card art comes from the account's stored `brand`, chosen by the user.
   *
   * This used to match the account NAME against a hardcoded list of eight, which
   * meant the set of supported designs was really a list of one person's
   * accounts — and read that way to anyone with the source. It also only ever
   * worked for names someone had already special-cased.
   *
   * A brand with no layout falls through to the per-type dispatch below rather
   * than rendering nothing, so retiring a design cannot blank a card.
   */
  const BrandLayout = account.brand ? BRAND_LAYOUTS[account.brand] : undefined;
  if (BrandLayout) {
    return (
      <BrandLayout
        account={account}
        onEdit={onEdit}
        onDelete={onDelete}
        onToggleArchive={onToggleArchive}
        onReconcile={onReconcile}
        onHide={onHide}
        isHidden={isHidden}
        onLedger={onLedger}
        rewardsAccount={rewardsAccount}
        onRewardsRowClick={onRewardsRowClick}
        onEarnRewards={onEarnRewards}
        onAdjustRewards={onAdjustRewards}
        onAddRewardsAccount={onAddRewardsAccount}
      />
    );
  }

  switch (account.type) {
    case 'Credit Card':
      return (
        <CreditCardLayout
          account={account}
          onEdit={onEdit}
          onDelete={onDelete}
          onToggleArchive={onToggleArchive}
          onReconcile={onReconcile}
          onHide={onHide}
          isHidden={isHidden}
          onLedger={onLedger}
          rewardsAccount={rewardsAccount}
          onRewardsRowClick={onRewardsRowClick}
          onEarnRewards={onEarnRewards}
          onAdjustRewards={onAdjustRewards}
          onAddRewardsAccount={onAddRewardsAccount}
        />
      );
    case 'Cash':
      return (
        <BanknoteLayout
          account={account}
          onEdit={onEdit}
          onDelete={onDelete}
          onToggleArchive={onToggleArchive}
          onReconcile={onReconcile}
          onHide={onHide}
          isHidden={isHidden}
          onLedger={onLedger}
          note="one"
        />
      );
    case 'Gift Card':
      return (
        <GiftCardLayout
          account={account}
          onEdit={onEdit}
          onDelete={onDelete}
          onToggleArchive={onToggleArchive}
          onReconcile={onReconcile}
          onHide={onHide}
          isHidden={isHidden}
          onLedger={onLedger}
        />
      );
    case 'HSA':
      return (
        <HsaLayout
          account={account}
          onEdit={onEdit}
          onDelete={onDelete}
          onToggleArchive={onToggleArchive}
          onReconcile={onReconcile}
          onHide={onHide}
          isHidden={isHidden}
          onLedger={onLedger}
        />
      );
    default:
      // Unbranded checking/savings accounts wear the $100.
      return (
        <BanknoteLayout
          account={account}
          onEdit={onEdit}
          onDelete={onDelete}
          onToggleArchive={onToggleArchive}
          onReconcile={onReconcile}
          onHide={onHide}
          isHidden={isHidden}
          onLedger={onLedger}
          note="hundred"
        />
      );
  }
}

/* ── Credit Card ── */

function CreditCardLayout({
  account,
  onEdit,
  onDelete,
  onToggleArchive,
  onReconcile,
  onHide,
  isHidden,
  onLedger,
  rewardsAccount,
  onRewardsRowClick,
  onEarnRewards,
  onAdjustRewards,
  onAddRewardsAccount,
}: AccountCardProps) {
  const { name, balance, archived } = account;

  return (
    // darkTheme remaps the DS contract to dark values, so this card's semantic
    // tokens stay a dark plastic card under every app theme.
    <div className={cn(darkTheme, s.cardBase, s.cardCreditCard, archived && s.cardArchived)}>
      <ActionButtons
        account={account}
        onEdit={onEdit}
        onDelete={onDelete}
        onToggleArchive={onToggleArchive}
        onReconcile={onReconcile}
        onHide={onHide}
        isHidden={isHidden}
        onLedger={onLedger}
        onEarnRewards={onEarnRewards}
        onAdjustRewards={onAdjustRewards}
        onAddRewardsAccount={onAddRewardsAccount}
        onDark
      />

      {/* Name — top left */}
      <div className={s.cardNameCredit}>{name}</div>

      {/* Spacer pushes chip section to center */}
      <div className={s.creditSpacer} />

      {/* Chip + contactless */}
      <div className={s.creditTopRow}>
        <div className={s.chip} />
        <div className={s.contactless}>
          <Wifi size={16} />
        </div>
      </div>

      {/* Card number dots */}
      <div className={s.cardDots}>
        <span>••••</span>
        <span>••••</span>
        <span>••••</span>
        <span>••••</span>
      </div>

      {/* Spacer pushes balance to bottom */}
      <div className={s.creditSpacer} />

      {/* Balance + rewards — bottom left */}
      <div>
        <RewardsLine rewardsAccount={rewardsAccount} onRewardsRowClick={onRewardsRowClick} />
        <span className={s.balanceCredit}>{formatCurrency(balance)}</span>
      </div>
    </div>
  );
}
