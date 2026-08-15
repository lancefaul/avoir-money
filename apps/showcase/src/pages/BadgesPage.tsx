import { TrendingUp, TrendingDown, AlertTriangle, Repeat, Bell, MessageSquare } from 'lucide-react';
import * as s from '../showcase.css.js';
import { Badge, BadgeCount, badgeStyles as b, buttonStyles as btn } from '@budget-tracker/ui';

export default function BadgesPage() {
  return (
    <>
      {/* ── Section 1: Semantic variants ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Semantic variants</div>
        <div className={s.row}>
          <Badge variant="positive">Positive</Badge>
          <Badge variant="negative">Negative</Badge>
          <Badge variant="warning">Warning</Badge>
          <Badge variant="info">Info</Badge>
          <Badge variant="neutral">Neutral</Badge>
          <Badge variant="brand">Brand</Badge>
        </div>
      </div>

      {/* ── Section 2: Sizes ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Sizes</div>
        <div className={s.row}>
          <div className={s.col}>
            <Badge variant="brand" size="sm">
              Small
            </Badge>
            <span className={s.ann}>sm</span>
          </div>
          <div className={s.col}>
            <Badge variant="brand">Default</Badge>
            <span className={s.ann}>md (default)</span>
          </div>
          <div className={s.col}>
            <Badge variant="brand" size="lg">
              Large
            </Badge>
            <span className={s.ann}>lg</span>
          </div>
          <div className={s.col}>
            <Badge variant="brand" size="xl">
              Extra Large
            </Badge>
            <span className={s.ann}>xl · 32px tall · 32px min-width</span>
          </div>
          <div className={s.col}>
            <Badge variant="warning" size="xl" iconOnly aria-label="Warning">
              <AlertTriangle size={14} />
            </Badge>
            <span className={s.ann}>xl icon-only · square · aria-label required</span>
          </div>
        </div>
      </div>

      {/* ── Section 3: With leading icon ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>With leading icon</div>
        <div className={s.row}>
          <Badge variant="positive">
            <TrendingUp size={10} /> +12.4%
          </Badge>
          <Badge variant="negative">
            <TrendingDown size={10} /> −3.2%
          </Badge>
          <Badge variant="warning">
            <AlertTriangle size={10} /> Due Apr 30
          </Badge>
          <Badge variant="info">
            <Repeat size={10} /> Monthly
          </Badge>
        </div>
      </div>

      {/* ── Section 5: With emoji ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>With emoji</div>
        <div className={s.row}>
          <Badge variant="info">🏠 Mortgage</Badge>
          <Badge variant="neutral">🚗 Auto loan</Badge>
          <Badge variant="positive">💰 Savings</Badge>
          <Badge variant="warning">⚡ Utilities</Badge>
        </div>
      </div>

      {/* ── Section: Truncation ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Truncation</div>
        <p className={s.ann}>
          With <code>truncate</code>, the pill shrinks to its container and the label truncates with
          an ellipsis inside the badge instead of overflowing.
        </p>
        <div className={s.row} style={{ alignItems: 'flex-start' }}>
          <div style={{ width: '9rem' }}>
            <Badge variant="info" truncate>
              🏠 Mortgage Escrow Payment
            </Badge>
          </div>
          <div style={{ width: '6rem' }}>
            <Badge variant="neutral" truncate>
              🛡️ Auto Insurance
            </Badge>
          </div>
          <div style={{ width: '9rem' }}>
            <Badge variant="brand" truncate>
              💻 Technology
            </Badge>
          </div>
        </div>
      </div>

      {/* ── Section 6: Count badges & notification dots ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Count badges &amp; notification dots</div>
        <div className={s.row}>
          <BadgeCount color="brand">3</BadgeCount>
          <BadgeCount color="danger">12</BadgeCount>
          <BadgeCount color="neutral">99+</BadgeCount>
        </div>
        <div className={s.row} style={{ marginTop: '1.5rem' }}>
          {/* Bell with count badge */}
          <span className={b.iconBadgeWrap}>
            <button
              className={`${btn.btnBase} ${btn.btnIconMd} ${btn.btnTrueGhost}`}
              type="button"
              aria-label="Notifications"
            >
              <Bell size={18} />
            </button>
            <BadgeCount color="danger" size="sm" className={b.iconBadgeCount}>
              5
            </BadgeCount>
          </span>
          {/* MessageSquare with count badge */}
          <span className={b.iconBadgeWrap}>
            <button
              className={`${btn.btnBase} ${btn.btnIconMd} ${btn.btnTrueGhost}`}
              type="button"
              aria-label="Messages"
            >
              <MessageSquare size={18} />
            </button>
            <BadgeCount color="brand" size="sm" className={b.iconBadgeCount}>
              2
            </BadgeCount>
          </span>
          {/* Bell with dot */}
          <span className={b.iconBadgeWrap}>
            <button
              className={`${btn.btnBase} ${btn.btnIconMd} ${btn.btnTrueGhost}`}
              type="button"
              aria-label="Notifications"
            >
              <Bell size={18} />
            </button>
            <span className={`${b.dotOnly} ${b.dotDanger} ${b.iconBadgeDot}`} />
          </span>
          {/* MessageSquare with dot */}
          <span className={b.iconBadgeWrap}>
            <button
              className={`${btn.btnBase} ${btn.btnIconMd} ${btn.btnTrueGhost}`}
              type="button"
              aria-label="Messages"
            >
              <MessageSquare size={18} />
            </button>
            <span className={`${b.dotOnly} ${b.dotBrand} ${b.iconBadgeDot}`} />
          </span>
        </div>
      </div>

      {/* ── Section: Interactive (chevron / dropdown trigger) ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Interactive — chevron (dropdown trigger)</div>
        <div className={s.row}>
          <Badge chevron variant="neutral">
            🍕 Food
          </Badge>
          <Badge chevron variant="brand" truncate>
            Monthly
          </Badge>
        </div>
        <p>
          `chevron` renders a trailing chevron + focus ring and forwards trigger props — pass it to
          Select&apos;s `trigger` prop to make a badge open a searchable dropdown.
        </p>
      </div>
    </>
  );
}
