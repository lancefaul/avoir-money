import { useState } from 'react';
import { EmojiPicker } from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';

export default function EmojiPickerPage() {
  const [emoji1, setEmoji1] = useState<string | undefined>(undefined);
  const [emoji2, setEmoji2] = useState<string>('🏠');
  const [emoji3, setEmoji3] = useState<string>('🎸');
  const [emoji4, setEmoji4] = useState<string | undefined>('🍕');

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
          Default (empty)
        </h3>
        <div style={{ maxWidth: '16rem' }}>
          <EmojiPicker value={emoji1} onChange={setEmoji1} />
        </div>
        <p
          style={{
            fontSize: vars.font.sm,
            color: vars.color.textSecondary,
            marginTop: vars.space['2'],
          }}
        >
          Selected: {emoji1 ?? 'none'}
        </p>
      </section>

      {/* Pre-selected */}
      <section>
        <h3
          style={{
            fontSize: vars.font.lg,
            fontWeight: vars.font.medium,
            color: vars.color.textPrimary,
            marginBottom: vars.space['3'],
          }}
        >
          Pre-selected (🏠)
        </h3>
        <div style={{ maxWidth: '16rem' }}>
          <EmojiPicker value={emoji2} onChange={setEmoji2} />
        </div>
        <p
          style={{
            fontSize: vars.font.sm,
            color: vars.color.textSecondary,
            marginTop: vars.space['2'],
          }}
        >
          Selected: {emoji2}
        </p>
      </section>

      {/* Compact – no label */}
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
          <EmojiPicker value={emoji3} onChange={setEmoji3} showLabel={false} />
        </div>
        <p
          style={{
            fontSize: vars.font.sm,
            color: vars.color.textSecondary,
            marginTop: vars.space['2'],
          }}
        >
          Selected: {emoji3}
        </p>
      </section>

      {/* Clearable */}
      <section>
        <h3
          style={{
            fontSize: vars.font.lg,
            fontWeight: vars.font.medium,
            color: vars.color.textPrimary,
            marginBottom: vars.space['3'],
          }}
        >
          Clearable
        </h3>
        <div style={{ maxWidth: '16rem' }}>
          <EmojiPicker value={emoji4} onChange={setEmoji4} onClear={() => setEmoji4(undefined)} />
        </div>
        <p
          style={{
            fontSize: vars.font.sm,
            color: vars.color.textSecondary,
            marginTop: vars.space['2'],
          }}
        >
          Selected: {emoji4 ?? 'none'}
        </p>
      </section>
    </div>
  );
}
