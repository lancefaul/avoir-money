import { useState } from 'react';
import { ColorPicker } from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';

export default function ColorPickerPage() {
  const [color1, setColor1] = useState<string | undefined>(undefined);
  const [color2, setColor2] = useState<string>('rose500');
  const [color3, setColor3] = useState<string>('neutral700');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['8'] }}>
      {/* Default – no selection */}
      <section>
        <h3
          style={{
            fontSize: vars.font.lg,
            fontWeight: vars.font.medium,
            color: vars.color.textPrimary,
            marginBottom: vars.space['3'],
          }}
        >
          Default (empty, clearable)
        </h3>
        <div style={{ maxWidth: '16rem' }}>
          <ColorPicker value={color1} onChange={setColor1} onClear={() => setColor1(undefined)} />
        </div>
        <p
          style={{
            fontSize: vars.font.sm,
            color: vars.color.textSecondary,
            marginTop: vars.space['2'],
          }}
        >
          Selected: {color1 ?? 'none'}
        </p>
      </section>

      {/* Pre-selected data viz color */}
      <section>
        <h3
          style={{
            fontSize: vars.font.lg,
            fontWeight: vars.font.medium,
            color: vars.color.textPrimary,
            marginBottom: vars.space['3'],
          }}
        >
          Pre-selected (Tomato 500)
        </h3>
        <div style={{ maxWidth: '16rem' }}>
          <ColorPicker value={color2} onChange={setColor2} />
        </div>
        <p
          style={{
            fontSize: vars.font.sm,
            color: vars.color.textSecondary,
            marginTop: vars.space['2'],
          }}
        >
          Selected: {color2}
        </p>
      </section>

      {/* Without label */}
      <section>
        <h3
          style={{
            fontSize: vars.font.lg,
            fontWeight: vars.font.medium,
            color: vars.color.textPrimary,
            marginBottom: vars.space['3'],
          }}
        >
          Compact (no label)
        </h3>
        <div style={{ maxWidth: '5rem' }}>
          <ColorPicker value={color3} onChange={setColor3} showLabel={false} />
        </div>
        <p
          style={{
            fontSize: vars.font.sm,
            color: vars.color.textSecondary,
            marginTop: vars.space['2'],
          }}
        >
          Selected: {color3}
        </p>
      </section>

      {/* Disabled */}
      <section>
        <h3
          style={{
            fontSize: vars.font.lg,
            fontWeight: vars.font.medium,
            color: vars.color.textPrimary,
            marginBottom: vars.space['3'],
          }}
        >
          Disabled
        </h3>
        <div style={{ maxWidth: '16rem' }}>
          <ColorPicker value="brand600" disabled />
        </div>
      </section>
    </div>
  );
}
