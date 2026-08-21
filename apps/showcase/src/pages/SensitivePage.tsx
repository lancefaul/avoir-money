import { useState } from 'react';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import * as s from '../showcase.css.js';
import { Sensitive, Toggle, MaskProvider } from '@budget-tracker/ui';

/**
 * `Sensitive` is the only DS component whose appearance depends on an ancestor,
 * so the showcase has to supply that ancestor itself — everywhere else in the
 * app it is the theme wrapper in `Layout`. The toggle below adds and removes
 * `maskedRoot` on the demo region, which is exactly what the title-bar control
 * does to the whole page.
 */
export default function SensitivePage() {
  const [masked, setMasked] = useState(true);

  const demo = (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: vars.space['3'],
        maxWidth: '25rem',
      }}
    >
      <Row label="Checking" value={<Sensitive label="balance">$4,182.55</Sensitive>} />
      <Row label="Credit card" value={<Sensitive label="balance">-$1,811.40</Sensitive>} />
      <Row
        label={<Sensitive label="account name">Northwind Savings</Sensitive>}
        value={<Sensitive label="balance">$12,004.00</Sensitive>}
      />
      {/* Structural text stays readable on purpose: a mask that hides the
          labels makes the page unusable rather than private. */}
      <Row label="Statement period" value="1–31 March" />
    </div>
  );

  return (
    <>
      <div className={s.section}>
        <div className={s.sectionLabel}>Masked / unmasked</div>
        <div style={{ marginBottom: vars.space['5'], maxWidth: '25rem' }}>
          <Toggle checked={masked} onChange={setMasked} label="Hide values" />
        </div>
        <MaskProvider masked={masked}>{demo}</MaskProvider>
      </div>

      <div className={s.section}>
        <div className={s.sectionLabel}>Substitution, not concealment</div>
        <p style={{ color: vars.color.textSecondary, maxWidth: '38rem' }}>
          A masked value renders <code>***</code> INSTEAD of its contents, so the real figure is
          never in the DOM — devtools, a text selection and the accessibility tree all see the
          asterisks. An earlier version painted a bar over the text with CSS, which hid it from the
          screen but not from any of those, and sized the bar to the value so the width still leaked
          the magnitude. Three fixed glyphs leak nothing.
        </p>
      </div>

      <div className={s.section}>
        <div className={s.sectionLabel}>What to wrap</div>
        <p style={{ color: vars.color.textSecondary, maxWidth: '38rem' }}>
          Anything naming a person, an institution or an amount: balances, transaction amounts,
          account and merchant names, budget names. Never structural text — a column heading reading
          &ldquo;Balance&rdquo; discloses nothing, and masking it costs legibility for no privacy.
        </p>
      </div>
    </>
  );
}

function Row({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: vars.space['4'],
        padding: vars.space['3'],
        background: vars.color.surfaceRaised,
        borderRadius: vars.radius.md,
        border: `1px solid ${vars.color.border}`,
      }}
    >
      <span style={{ color: vars.color.textSecondary }}>{label}</span>
      <span style={{ color: vars.color.textPrimary, fontFamily: vars.font.display }}>{value}</span>
    </div>
  );
}
