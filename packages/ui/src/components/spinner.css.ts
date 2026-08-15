import { style, globalKeyframes } from '@vanilla-extract/css';

/**
 * A continuous 360° rotation for loading icons (e.g. a lucide `Loader2`).
 *
 * Several app views set `animation: 'spin 1s linear infinite'` inline, but no
 * `spin` keyframe was ever defined, so those spinners rendered frozen. This is
 * the shared, real keyframe + class they should use.
 *
 * The 1s period is an animation timing, not one of the design tokens DESIGN.md
 * governs (color / spacing / type / radius) — the DS button spinner likewise
 * hardcodes its own period.
 */
const spin = 'ds-spin';

globalKeyframes(spin, {
  '0%': { transform: 'rotate(0deg)' },
  '100%': { transform: 'rotate(360deg)' },
});

export const spinIcon = style({
  animation: `${spin} 1s linear infinite`,
});
