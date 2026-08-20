import { vars } from '@budget-tracker/ui/theme/contract.css.js';

const AMOUNT_SAMPLES = ['$1,234.56', '$   46.70', '$  158.83'];

const DATE_SAMPLES = ['Due 04/13/2026', 'Due 05/11/2026', 'Due 12/01/2026'];

export function TabularNumeralsPanel() {
  return (
    <div
      style={{
        background: vars.color.surface,
        border: `${vars.border.hairline} solid ${vars.color.border}`,
        borderRadius: vars.radius.xl,
        padding: vars.space['5'],
        boxShadow: vars.shadow.sm,
      }}
    >
      <div
        style={{
          fontSize: vars.font.xs,
          fontWeight: vars.font.semibold,
          letterSpacing: vars.font.trackingWide,
          textTransform: 'uppercase' as const,
          color: vars.color.textTertiary,
          marginBottom: vars.space['3'],
        }}
      >
        Tabular numerals test · font-feature-settings: &quot;tnum&quot;
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: vars.space['6'],
        }}
      >
        {/* Amounts column */}
        <div>
          <div
            style={{
              fontSize: vars.font.xs,
              color: vars.color.textTertiary,
              marginBottom: vars.space['2'],
            }}
          >
            Amounts (should align on decimal)
          </div>
          <div
            style={{
              fontSize: vars.font.lg,
              fontFeatureSettings: '"tnum"',
              fontVariantNumeric: 'tabular-nums',
              lineHeight: vars.font.leadingRelaxed,
              color: vars.color.textPrimary,
              whiteSpace: 'pre',
            }}
          >
            {AMOUNT_SAMPLES.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        </div>

        {/* Dates column */}
        <div>
          <div
            style={{
              fontSize: vars.font.xs,
              color: vars.color.textTertiary,
              marginBottom: vars.space['2'],
            }}
          >
            Dates (should align vertically)
          </div>
          <div
            style={{
              fontSize: vars.font.lg,
              fontFeatureSettings: '"tnum"',
              fontVariantNumeric: 'tabular-nums',
              lineHeight: vars.font.leadingRelaxed,
              color: vars.color.textPrimary,
              whiteSpace: 'pre',
            }}
          >
            {DATE_SAMPLES.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const TERMINAL_LINES = [
  { text: '◌ Parsing CSV file…', color: '#8b9099' },
  { text: '✓ Parsed 247 rows (3 duplicates removed)', color: '#6cc9a1' },
  { text: '◌ Resolving accounts…', color: '#8b9099' },
  { text: '✓ Mapped "Chase Visa" → Prime Visa (Chase)', color: '#6cc9a1' },
  { text: '⚠ Unknown account "Fidelity 401k" — created new', color: '#e5a84b' },
  { text: '✓ Resolved 5 accounts', color: '#6cc9a1' },
  { text: '◌ Importing transactions…', color: '#8b9099' },
  { text: '  ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰ 100%', color: '#6cc9a1' },
  { text: '✓ 244 imported, 0 errors, 3 skipped', color: '#6cc9a1' },
  { text: '', color: 'transparent' },
  { text: '$ budget-tracker import --file=transactions.csv --verbose', color: '#5c6370' },
];

export function CodeFontPanel() {
  return (
    <div
      style={{
        background: '#0d0f14',
        borderRadius: vars.radius.xl,
        padding: vars.space['6'],
        boxShadow: vars.shadow.sm,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          fontSize: vars.font.xs,
          fontWeight: vars.font.semibold,
          letterSpacing: vars.font.trackingWide,
          textTransform: 'uppercase' as const,
          color: vars.color.neutral400,
          marginBottom: vars.space['4'],
        }}
      >
        Code font preview · import terminal
      </div>
      <div
        style={{
          fontFamily: vars.font.code,
          fontSize: vars.font.base,
          lineHeight: '1.8',
        }}
      >
        {TERMINAL_LINES.map((line, i) => (
          <p
            key={i}
            style={{
              margin: 0,
              whiteSpace: 'pre-wrap',
              color: line.color,
            }}
          >
            {line.text || '\u00A0'}
          </p>
        ))}
      </div>
    </div>
  );
}
