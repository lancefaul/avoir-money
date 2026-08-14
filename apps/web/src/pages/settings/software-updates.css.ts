import { style } from '@vanilla-extract/css';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { contentScroll } from '../../components/settings-modal.css.js';

/**
 * This pane's scroll area — `contentScroll` without the reserved gutter.
 *
 * `contentScroll` sets `scrollbar-gutter: stable`, which reserves a scrollbar's
 * width between the border edge and the padding edge whether or not anything
 * scrolls. Nothing inside can then reach the right border edge, so the
 * full-bleed rule below would run flush on the left and stop ~15px short on the
 * right — the "ghost padding" in ERRORS.md, where a gap survives `padding: 0`
 * because it was never padding.
 *
 * `auto` gives up a stable width while scrolling in exchange for symmetric
 * edges, which is the trade this pane wants: it is short in every state except
 * a long history, and a rule that visibly misses one edge is the thing being
 * fixed.
 */
export const scroll = style([contentScroll, { scrollbarGutter: 'auto' }]);

/**
 * The scroll body's own stack.
 *
 * No wrapper element and no padding: `contentScroll` already supplies both, and
 * the surrounding `contentHeader`/`contentScroll` pair is what every other
 * settings pane uses. The first version of this file wrapped everything in its
 * own `maxWidth` container with its own heading, which is exactly how it ended
 * up looking like a different product.
 */
export const body = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space['5'],
});

/**
 * Body copy. `base` rather than `sm` — one token up, matching the size help
 * text is set at on the other settings panes.
 */
export const muted = style({
  color: vars.color.textSecondary,
  fontSize: vars.font.base,
  margin: 0,
});

/**
 * The "this install can never self-update" panel, which is not an error.
 *
 * Same card as `ConnectedServices` builds for each service — `surface` on the
 * page background, hairline border, `lg` radius, `space['4']` padding, a column
 * with `space['2']` between rows.
 */
export const notice = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space['2'],
  padding: vars.space['4'],
  borderRadius: vars.radius.lg,
  border: `${vars.border.hairline} solid ${vars.color.border}`,
  background: vars.color.surface,
});

/** The icon + heading row, matching the service card's header. */
export const noticeHead = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['2'],
  color: vars.color.textPrimary,
  fontSize: vars.font.base,
  fontWeight: 600,
});

/**
 * The buttons, and the rule that closes the pane's first section.
 *
 * Full-bleed by negative inline margins equal to `scroll`'s padding, with the
 * same value added back as padding so the buttons do not move. A divider that
 * stops short of both edges reads as a box drawn around the buttons; one that
 * crosses the pane reads as a division of it, which is what it is — and it
 * matches `contentHeader`'s own border, which spans the full width because a
 * border sits outside padding.
 */
export const actions = style({
  display: 'flex',
  gap: vars.space['3'],
  flexWrap: 'wrap',
  paddingBottom: vars.space['5'],
  marginInline: `calc(${vars.space['6']} * -1)`,
  paddingInline: vars.space['6'],
  borderBottom: `${vars.border.hairline} solid ${vars.color.border}`,
});

export const historySection = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space['3'],
});

/**
 * The history list.
 *
 * The same container `BackupSettings` builds for backup history: one bordered,
 * rounded, clipped box with hairline-separated rows, rather than a stack of
 * separate cards. Two lists of past events in one settings area should not be
 * two different objects.
 */
export const historyList = style({
  listStyle: 'none',
  margin: 0,
  padding: 0,
  border: `${vars.border.thin} solid ${vars.color.border}`,
  borderRadius: vars.radius.lg,
  overflow: 'hidden',
  background: vars.color.neutral0,
});

export const historyItem = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['3'],
  padding: `${vars.space['3']} ${vars.space['4']}`,
  selectors: {
    // Every row but the last, so the box's own border is not doubled.
    '&:not(:last-child)': {
      borderBottom: `${vars.border.hairline} solid ${vars.color.border}`,
    },
  },
});

/**
 * The row's primary line.
 *
 * The UI face, not `code`. It was mono while the line was a bare `0.8.0 →
 * 0.9.0` — a pair of values, where fixed width helps them line up. It is a
 * sentence now, and a sentence set in mono reads as output rather than as
 * something the app is telling you.
 */
export const historyPrimary = style({
  fontSize: vars.font.base,
  fontWeight: vars.font.medium,
  color: vars.color.textPrimary,
});

/** The timestamp — the row's secondary line. */
export const historySecondary = style({
  fontSize: vars.font.sm,
  color: vars.color.textTertiary,
  marginTop: vars.space['0.5'],
});

/* ── The package-manager commands ── */

/**
 * Which distribution a command is for, and how to paste it, are now `# comment`
 * lines inside the console blocks rather than labels and help text around them.
 * A comment above a command is how that information appears in every install
 * guide the user has ever followed, and it means the copyable thing and the
 * thing explaining it are not two different objects on the page.
 *
 * Their sizing comes free: console text is `vars.font.base`, one token above the
 * `vars.font.sm` the labels used to be — which is the bump that was asked for.
 * The `commandLabel`, `commandHead`, `hint` and `kbd` styles went with them.
 */
export const commandStack = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space['3'],
});

/**
 * The bullet in the pane's subtitle.
 *
 * Its own element so it can be dimmed a step below the text it separates —
 * a separator that reads as loud as the things it separates is doing the
 * opposite of its job. `space['2']` on each side is the two-space gap asked
 * for, expressed as a token: consecutive spaces in HTML collapse to one, so
 * literal spacing here would silently render as a single gap.
 */
export const bullet = style({
  color: vars.color.textTertiary,
  marginInline: vars.space['2'],
});
