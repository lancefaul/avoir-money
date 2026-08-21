import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import * as s from '../showcase.css.js';

export default function SpacingPage() {
  return (
    <div className={s.section}>
      <div className={s.sectionLabel}>Spacing – 4px base grid</div>
      <div>
        {[
          { token: '0', width: vars.space['0'], label: 'space-0 · 0px' },
          { token: '0.5', width: vars.space['0.5'], label: 'space-0.5 · 2px' },
          {
            token: '1',
            width: vars.space['1'],
            label: 'space-1 · 4px – icon gaps, tight inline',
          },
          {
            token: '2',
            width: vars.space['2'],
            label: 'space-2 · 8px – badge padding, between row items',
          },
          {
            token: '3',
            width: vars.space['3'],
            label: 'space-3 · 12px – compact form field gap',
          },
          {
            token: '4',
            width: vars.space['4'],
            label: 'space-4 · 16px – standard form field gap, card padding sm',
          },
          { token: '5', width: vars.space['5'], label: 'space-5 · 20px' },
          {
            token: '6',
            width: vars.space['6'],
            label: 'space-6 · 24px – card padding default, section gap',
          },
          { token: '7', width: vars.space['7'], label: 'space-7 · 28px' },
          {
            token: '8',
            width: vars.space['8'],
            label: 'space-8 · 32px – between sections',
          },
          { token: '10', width: vars.space['10'], label: 'space-10 · 40px' },
          {
            token: '12',
            width: vars.space['12'],
            label: 'space-12 · 48px – page padding, major rhythm',
          },
          { token: '16', width: vars.space['16'], label: 'space-16 · 64px' },
        ].map((item) => (
          <div key={item.token} className={s.spacingRow}>
            <div className={s.spacingBar} style={{ width: item.width }} />
            <span className={s.spacingLabel}>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
