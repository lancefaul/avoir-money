import { style } from '@vanilla-extract/css';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';

export const actionBar = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['3'],
  padding: `${vars.space['4']} ${vars.space['6']}`,
  borderTop: `${vars.border.hairline} solid ${vars.color.border}`,
  flexShrink: 0,
});
