import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import * as s from '../showcase.css.js';
import { TabularNumeralsPanel, CodeFontPanel } from '../TabularNumeralsPanel.js';

const fontMeta = {
  light: {
    heading: {
      name: 'DM Serif Display',
      meta: 'Google Fonts · Display / Heading · Regular + Italic',
    },
    body: { name: 'DM Sans', meta: 'Google Fonts · UI / Body · 400 + 500 + 600' },
  },
  dark: {
    heading: {
      name: 'DM Serif Display',
      meta: 'Google Fonts · Display / Heading · Regular + Italic',
    },
    body: { name: 'DM Sans', meta: 'Google Fonts · UI / Body · 400 + 500 + 600' },
  },
  cipherpunk: {
    heading: { name: 'Geist', meta: 'Vercel · Display / Heading · 400 + 500 + 600' },
    body: { name: 'Geist Mono', meta: 'Vercel · UI / Body · 400 + 500' },
  },
} as const;

type ThemeId = keyof typeof fontMeta;

export default function TypographyPage({ theme }: { theme: ThemeId }) {
  return (
    <>
      {/* ── Font pairing ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>
          Font pairing – {fontMeta[theme].heading.name} + {fontMeta[theme].body.name}
        </div>

        {/* Heading font card */}
        <div className={s.pairingCard}>
          <div className={s.pairingHeader}>
            <div>
              <div className={s.pairingHeaderName}>{fontMeta[theme].heading.name}</div>
              <div className={s.pairingHeaderMeta}>{fontMeta[theme].heading.meta}</div>
            </div>
            <div
              style={{
                fontSize: vars.font.xs,
                color: vars.color.textTertiary,
                textAlign: 'right' as const,
                lineHeight: vars.font.leadingRelaxed,
              }}
            >
              Hero numbers, page titles,
              <br />
              stat cards, section headings
            </div>
          </div>
          <div className={s.pairingBody}>
            <div className={s.typeRow}>
              <div className={s.typeSample}>
                <span
                  style={{
                    fontFamily: vars.font.display,
                    fontSize: vars.font.hero,
                    color: vars.color.textPrimary,
                    lineHeight: vars.font.leadingTight,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  $214,269
                </span>
              </div>
              <div>
                <div className={s.typeSpec}>{fontMeta[theme].heading.name} · 48px · hero stat</div>
              </div>
            </div>
            <div className={s.typeRow}>
              <div className={s.typeSample}>
                <span
                  style={{
                    fontFamily: vars.font.display,
                    fontSize: vars.font['4xl'],
                    color: vars.color.textPrimary,
                  }}
                >
                  Debts (3)
                </span>
              </div>
              <div>
                <div className={s.typeSpec}>
                  {fontMeta[theme].heading.name} · 32px · page title (large)
                </div>
              </div>
            </div>
            <div className={s.typeRow}>
              <div className={s.typeSample}>
                <span
                  style={{
                    fontFamily: vars.font.display,
                    fontSize: vars.font['3xl'],
                    color: vars.color.textPrimary,
                  }}
                >
                  Investments
                </span>
              </div>
              <div>
                <div className={s.typeSpec}>
                  {fontMeta[theme].heading.name} · 24px · page title (standard)
                </div>
              </div>
            </div>
            <div className={s.typeRow}>
              <div className={s.typeSample}>
                <span
                  style={{
                    fontFamily: vars.font.display,
                    fontSize: vars.font['2xl'],
                    color: vars.color.textPrimary,
                  }}
                >
                  $30,371.06
                </span>
              </div>
              <div>
                <div className={s.typeSpec}>
                  {fontMeta[theme].heading.name} · 20px · card stat number
                </div>
              </div>
            </div>
            <div className={s.typeRow}>
              <div className={s.typeSample}>
                <span
                  style={{
                    fontFamily: vars.font.display,
                    fontSize: vars.font.xl,
                    fontStyle: 'italic',
                    color: vars.color.textSecondary,
                  }}
                >
                  "Refinanced June 2024 at 5.9%"
                </span>
              </div>
              <div>
                <div className={s.typeSpec}>
                  {fontMeta[theme].heading.name} · 18px · italic · note / quote
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Body font card */}
        <div className={s.pairingCard}>
          <div className={s.pairingHeader}>
            <div>
              <div className={s.pairingHeaderName}>{fontMeta[theme].body.name}</div>
              <div className={s.pairingHeaderMeta}>{fontMeta[theme].body.meta}</div>
            </div>
            <div
              style={{
                fontSize: vars.font.xs,
                color: vars.color.textTertiary,
                textAlign: 'right' as const,
                lineHeight: vars.font.leadingRelaxed,
              }}
            >
              Labels, body, buttons,
              <br />
              nav, inputs, table cells
            </div>
          </div>
          <div className={s.pairingBody}>
            <div className={s.typeRow}>
              <div className={s.typeSample}>
                <span
                  style={{
                    fontSize: vars.font.lg,
                    fontWeight: vars.font.regular,
                    color: vars.color.textPrimary,
                    lineHeight: vars.font.leadingRelaxed,
                  }}
                >
                  Minimum payment due Apr 18, 2026. Your next payment will be deducted
                  automatically.
                </span>
              </div>
              <div>
                <div className={s.typeSpec}>
                  {fontMeta[theme].body.name} · 14px / 400 · body text
                </div>
              </div>
            </div>
            <div className={s.typeRow}>
              <div className={s.typeSample}>
                <span
                  style={{
                    fontSize: vars.font.base,
                    fontWeight: vars.font.medium,
                    color: vars.color.textPrimary,
                  }}
                >
                  Cost basis
                </span>
              </div>
              <div>
                <div className={s.typeSpec}>
                  {fontMeta[theme].body.name} · 13px / 500 · field label
                </div>
              </div>
            </div>
            <div className={s.typeRow}>
              <div className={s.typeSample}>
                <span
                  style={{
                    fontSize: vars.font.base,
                    fontWeight: vars.font.regular,
                    color: vars.color.textPrimary,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  $30,371.06
                </span>
              </div>
              <div>
                <div className={s.typeSpec}>
                  {fontMeta[theme].body.name} · 13px / 400 · tabular-nums · table cell
                </div>
              </div>
            </div>
            <div className={s.typeRow}>
              <div className={s.typeSample}>
                <span
                  style={{
                    fontSize: vars.font.base,
                    fontWeight: vars.font.medium,
                    color: vars.color.brand600,
                  }}
                >
                  Add account
                </span>
              </div>
              <div>
                <div className={s.typeSpec}>
                  {fontMeta[theme].body.name} · 13px / 500 · brand · button label
                </div>
              </div>
            </div>
            <div className={s.typeRow}>
              <div className={s.typeSample}>
                <span
                  style={{
                    fontSize: vars.font.sm,
                    fontWeight: vars.font.regular,
                    color: vars.color.textSecondary,
                  }}
                >
                  Last updated 2 hours ago · Visible only to you.
                </span>
              </div>
              <div>
                <div className={s.typeSpec}>
                  {fontMeta[theme].body.name} · 12px / 400 · helper / secondary
                </div>
              </div>
            </div>
            <div className={s.typeRow}>
              <div className={s.typeSample}>
                <span
                  style={{
                    fontSize: vars.font.xs,
                    fontWeight: vars.font.semibold,
                    letterSpacing: vars.font.trackingWide,
                    textTransform: 'uppercase',
                    color: vars.color.textTertiary,
                  }}
                >
                  Bill date
                </span>
              </div>
              <div>
                <div className={s.typeSpec}>
                  {fontMeta[theme].body.name} · 11px / 600 / CAPS · table header only
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Dashboard mockup ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Font pairing in context – dashboard snapshot</div>
        <div className={s.card}>
          <div className={s.statGrid}>
            <div className={s.statCard}>
              <div className={s.statLabel}>Total balance</div>
              <div className={s.statValue} style={{ color: vars.color.danger400 }}>
                $214,269
              </div>
              <div className={s.statSub}>3 active debts</div>
            </div>
            <div className={s.statCard}>
              <div className={s.statLabel}>Monthly minimum</div>
              <div className={s.statValue}>$2,508</div>
              <div className={s.statSub}>Due across 3 accounts</div>
            </div>
            <div className={s.statCard}>
              <div className={s.statLabel}>Debt-free date</div>
              <div className={s.statValue}>May 2050</div>
              <div className={s.statSub}>181 months remaining</div>
            </div>
          </div>
          <div className={s.sectionHeading}>Active debts</div>
          <div className={s.tableWrap}>
            <div className={s.tableHead}>
              <span className={s.tableHeadCell}>Name</span>
              <span className={s.tableHeadCell} style={{ textAlign: 'right' }}>
                Balance
              </span>
              <span className={s.tableHeadCell} style={{ textAlign: 'right' }}>
                APR
              </span>
              <span className={s.tableHeadCell} style={{ textAlign: 'right' }}>
                Min payment
              </span>
            </div>
            <div className={s.tableRow}>
              <div>
                <div className={s.rowName}>Family SUV</div>
                <div className={s.rowSub}>Auto loan · Monthly</div>
              </div>
              <div className={s.rowNum} style={{ color: vars.color.danger400 }}>
                $30,371
              </div>
              <div className={s.rowNum}>5.9%</div>
              <div className={s.rowNum}>$1,250.00</div>
            </div>
            <div className={s.tableRow}>
              <div>
                <div className={s.rowName}>Family Van</div>
                <div className={s.rowSub}>Auto loan · Monthly</div>
              </div>
              <div className={s.rowNum} style={{ color: vars.color.danger400 }}>
                $27,346
              </div>
              <div className={s.rowNum}>5.9%</div>
              <div className={s.rowNum}>$980.00</div>
            </div>
            <div className={s.tableRow}>
              <div>
                <div className={s.rowName}>Home Mortgage</div>
                <div className={s.rowSub}>Mortgage · Monthly</div>
              </div>
              <div className={s.rowNum} style={{ color: vars.color.danger400 }}>
                $156,551
              </div>
              <div className={s.rowNum}>3.25%</div>
              <div className={s.rowNum}>$1,204.83</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Tabular numerals test ── */}
      <div className={s.section}>
        <TabularNumeralsPanel />
      </div>

      {/* ── Code font test ── */}
      <div className={s.section}>
        <CodeFontPanel />
      </div>
    </>
  );
}
