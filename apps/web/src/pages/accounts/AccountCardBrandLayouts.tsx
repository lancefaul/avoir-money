import { Sensitive } from '@budget-tracker/ui';
import { ChevronRight } from 'lucide-react';
import { formatCurrency, cn } from '../../lib/utils.js';
import { darkTheme } from '@budget-tracker/ui/theme/theme-dark.css.js';
import * as s from './account-card.css.js';
import { ActionButtons, type AccountCardProps } from './AccountCardActions.js';

/**
 * The on-card rewards line (rewards-as-child-account model). When a card has a
 * nested Rewards account it renders a tappable row reading that account's balance
 * (tap → its ledger); otherwise nothing.
 */
export function RewardsLine({
  rewardsAccount,
  onRewardsRowClick,
}: Pick<AccountCardProps, 'rewardsAccount' | 'onRewardsRowClick'>) {
  if (!rewardsAccount) return null;
  return (
    <button
      type="button"
      className={s.rewardsRowButton}
      onClick={(e) => {
        e.stopPropagation();
        onRewardsRowClick?.();
      }}
    >
      <span>
        Rewards <span style={{ opacity: 0.5 }}>•</span>{' '}
        <Sensitive label="account balance">
          <Sensitive label="amount">
            <Sensitive label="amount">{formatCurrency(rewardsAccount.balance)}</Sensitive>
          </Sensitive>
        </Sensitive>
      </span>
      <ChevronRight size={14} />
    </button>
  );
}

/* Bank/debit brand-replica layouts (Prime Visa, banknotes, HSA, Cash Wallet,
   Fidelity, Community First), extracted from AccountCard.tsx. */

/* ── Prime Visa — Whole Foods Market ── */

export function PrimeVisaLayout({
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
  const { balance, archived } = account;

  return (
    // Also dark, and it shares the credit card's balance/rewards styles — so it
    // needs the same dark contract for those tokens to resolve legibly.
    <div className={cn(darkTheme, s.cardBase, s.cardPrimeVisa, archived && s.cardArchived)}>
      {/* Brushed metal texture */}
      <div className={s.primeVisaTexture} />

      {/* Decorative carrots/tree silhouette */}
      <img src="/carrots.svg" alt="" aria-hidden="true" className={s.primeVisaCarrots} />

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

      {/* Whole Foods logo — top left */}
      <img src="/whole-foods-logo.svg" alt="Whole Foods Market" className={s.primeVisaWfLogo} />

      {/* Spacer */}
      <div className={s.creditSpacer} />

      {/* Bottom: balance + rewards left, Visa Signature right */}
      <div className={s.primeVisaBottomRow}>
        <div>
          <RewardsLine rewardsAccount={rewardsAccount} onRewardsRowClick={onRewardsRowClick} />
          <span className={s.primeVisaBalance}>
            <Sensitive label="account balance">
              <Sensitive label="amount">
                <Sensitive label="amount">{formatCurrency(balance)}</Sensitive>
              </Sensitive>
            </Sensitive>
          </span>
        </div>
        <img src="/visa-signature.svg" alt="Visa Signature" className={s.primeVisaVisaLogo} />
      </div>
    </div>
  );
}

/* ── X Money — X (Twitter) brushed-metal debit/flex ── */

export function XMoneyLayout({
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

  // A light silver card, so no darkTheme (dark text) and the default (light)
  // ActionButtons — unlike the dark Prime Visa above.
  return (
    <div className={cn(s.cardBase, s.cardXMoney, archived && s.cardArchived)}>
      {/* Brushed metal + embossed X */}
      <div className={s.xMoneyTexture} />
      <div className={s.xMoneyMark} />

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

      <div className={s.creditSpacer} />

      {/* Bottom: balance left, Visa · Debit / Flex right */}
      <div className={s.xMoneyBottomRow}>
        <span className={s.xMoneyBalance}>
          <Sensitive label="account balance">
            <Sensitive label="amount">
              <Sensitive label="amount">{formatCurrency(balance)}</Sensitive>
            </Sensitive>
          </Sensitive>
        </span>
        <div className={s.xMoneyVisaWrap}>
          <img src="/visa-logo.svg" alt="Visa" className={s.xMoneyVisaLogo} />
          <span className={s.xMoneyDebitFlex}>Debit / Flex</span>
        </div>
      </div>
    </div>
  );
}

/* ── Banknote cards ──
   Cash accounts wear the $1 (Washington, green); unbranded checking/savings
   wear the $100 (Franklin, copper on blue-grey paper). Same anatomy as the
   branded gift cards: mark top-left, portrait behind, balance bottom-left. */

// The seal's interior detail is painted line work, not a transparent knockout,
// so each note carries a seal whose knockouts match its own paper.
const NOTES = {
  one: {
    portrait: '/george-washington.svg',
    seal: '/treasury-seal.svg',
    card: undefined,
    scrim: s.cashScrim,
  },
  hundred: {
    portrait: '/benjamin-franklin.svg',
    seal: '/treasury-seal-cnote.svg',
    card: s.cardCNote,
    scrim: s.cNoteScrim,
  },
} as const;

export function BanknoteLayout({
  account,
  onEdit,
  onDelete,
  onToggleArchive,
  onReconcile,
  onHide,
  isHidden,
  onLedger,
  note = 'one',
}: Omit<AccountCardProps, 'onAddRewards'> & { note?: keyof typeof NOTES }) {
  const { name, balance, archived } = account;
  const n = NOTES[note];

  return (
    <div className={cn(s.cardBase, s.cardCashSeal, n.card, archived && s.cardArchived)}>
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

      {/* Portrait engraving — decorative background, like the smile on the Amazon card */}
      <img src={n.portrait} alt="" aria-hidden="true" className={s.cashWashington} />

      {/* Paper scrim — fades the engraving out under the text so it stays crisp */}
      <div className={n.scrim} aria-hidden="true" />

      {/* Treasury seal — top left, where a brand logo sits on the other cards */}
      <img src={n.seal} alt="" aria-hidden="true" className={s.cashSealLogo} />

      {/* Bottom: balance + name (a banknote has no brand mark to identify it) */}
      <div className={s.cashSealBottom}>
        <span className={s.cashSealBalanceRow}>
          <Sensitive label="account balance">
            <Sensitive label="amount">
              <Sensitive label="amount">{formatCurrency(balance)}</Sensitive>
            </Sensitive>
          </Sensitive>
        </span>
        <span className={s.cashSealName}>
          <Sensitive label="account name">{name}</Sensitive>
        </span>
      </div>
    </div>
  );
}

/* ── HSA — Optum Debit Card ── */

export function HsaLayout({
  account,
  onEdit,
  onDelete,
  onToggleArchive,
  onReconcile,
  onHide,
  isHidden,
  onLedger,
}: Omit<AccountCardProps, 'onAddRewards'>) {
  const { balance, archived } = account;

  return (
    <div className={cn(s.cardBase, s.cardHsa, archived && s.cardArchived)}>
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

      {/* Optum logo — top left */}
      <img src="/optum-logo.svg" alt="Optum" className={s.hsaLogo} />

      {/* Balance — bottom left */}
      <span className={s.hsaBalanceRow}>
        <Sensitive label="account balance">
          <Sensitive label="amount">
            <Sensitive label="amount">{formatCurrency(balance)}</Sensitive>
          </Sensitive>
        </Sensitive>
      </span>

      {/* Debit + Mastercard — bottom right */}
      <div className={s.hsaBottomRight}>
        <span className={s.hsaDebitLabel}>debit</span>
        <img src="/mastercard-logo.svg" alt="Mastercard" className={s.hsaMastercardLogo} />
      </div>
    </div>
  );
}

/* ── Cash Wallet — Debit Card ── */

export function CashAppLayout({
  account,
  onEdit,
  onDelete,
  onToggleArchive,
  onReconcile,
  onHide,
  isHidden,
  onLedger,
}: Omit<AccountCardProps, 'onAddRewards'>) {
  const { balance, archived } = account;

  return (
    <div className={cn(s.cardBase, s.cardCashApp, archived && s.cardArchived)}>
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

      {/* Cash Wallet logo — top left */}
      <img src="/cash-app-logo.svg" alt="Cash Wallet" className={s.cashAppLogo} />

      {/* Balance — bottom left */}
      <span className={s.cashAppBalanceRow}>
        <Sensitive label="account balance">
          <Sensitive label="amount">
            <Sensitive label="amount">{formatCurrency(balance)}</Sensitive>
          </Sensitive>
        </Sensitive>
      </span>

      {/* Debit + Visa — bottom right */}
      <div className={s.cashAppBottomRight}>
        <span className={s.cashAppDebitLabel}>debit</span>
        <img src="/visa-logo.svg" alt="Visa" className={s.cashAppVisaLogo} />
      </div>
    </div>
  );
}

/* ── Fidelity Cash Management ── */

export function FidelityLayout({
  account,
  onEdit,
  onDelete,
  onToggleArchive,
  onReconcile,
  onHide,
  isHidden,
  onLedger,
}: Omit<AccountCardProps, 'onAddRewards'>) {
  const { balance, archived } = account;

  return (
    <div className={cn(s.cardBase, s.cardFidelity, archived && s.cardArchived)}>
      {/* Triangle pattern background */}
      <div className={s.fidelityTriangles} />

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

      {/* Fidelity full logo — top left (white) */}
      <img src="/fidelity-full-logo.svg" alt="Fidelity" className={s.fidelityFullLogo} />

      {/* Fidelity circle logo — centered (white) */}
      <img
        src="/fidelity-circle-logo-2.svg"
        alt=""
        aria-hidden="true"
        className={s.fidelityCircleLogo}
      />

      {/* Bottom: balance left, debit + visa right */}
      <div className={s.fidelityBottom}>
        <span className={s.fidelityBalanceRow}>
          <Sensitive label="account balance">
            <Sensitive label="amount">
              <Sensitive label="amount">{formatCurrency(balance)}</Sensitive>
            </Sensitive>
          </Sensitive>
        </span>
        <div className={s.fidelityBottomRight}>
          <span className={s.fidelityDebitLabel}>debit</span>
          <img src="/visa-logo.svg" alt="Visa" className={s.fidelityVisaLogo} />
        </div>
      </div>
    </div>
  );
}

/* ── Community First Bank ── */

export function CommunityFirstLayout({
  account,
  onEdit,
  onDelete,
  onToggleArchive,
  onReconcile,
  onHide,
  isHidden,
  onLedger,
}: Omit<AccountCardProps, 'onAddRewards'>) {
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

      {/* Centered Community First Bank logo */}
      <img
        src="/community-first-bank-new-iberia.png"
        alt="Community First Bank"
        className={s.costcoLogo}
      />

      {/* Balance — bottom left */}
      <div className={s.appleBottom}>
        <span className={s.appleBalanceRow}>
          <Sensitive label="account balance">
            <Sensitive label="amount">
              <Sensitive label="amount">{formatCurrency(balance)}</Sensitive>
            </Sensitive>
          </Sensitive>
        </span>
      </div>
    </div>
  );
}
