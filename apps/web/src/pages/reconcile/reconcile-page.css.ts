import { style } from '@vanilla-extract/css';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { from } from '@budget-tracker/ui/theme/breakpoints.js';

/* ── Full-screen modal shell (matches the import modal's dimensions) ── */

export const panel = style({
  maxWidth: '75rem',
  maxHeight: 'calc(100vh - 4rem)',
  width: '100%',
  height: '100%',
});

export const modalBody = style({
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
  overflow: 'hidden',
  padding: 0,
  scrollbarGutter: 'auto',
});

/** The scrolling region inside the modal, below the fixed step bar. */
export const modalScroll = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space['5'],
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  padding: vars.space['6'],
});

export const modalStepBar = style({
  padding: `${vars.space['5']} ${vars.space['6']}`,
  borderBottom: `${vars.border.hairline} solid ${vars.color.border}`,
  flexShrink: 0,
});

/** Pinned action bar, matching the import modal's. */
export const modalFooter = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: vars.space['3'],
  padding: `${vars.space['4']} ${vars.space['6']}`,
  borderTop: `${vars.border.hairline} solid ${vars.color.border}`,
  flexShrink: 0,
});

export const footerRight = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['3'],
});

/* ── Residual header ── */

/**
 * Auto-fitting so the row reads the same with three cards or four.
 *
 * The fourth — activity after the period end — appears only when there is any,
 * and a fixed three-column grid would either strand it on its own line or force
 * a second layout to maintain.
 */
export const statGrid = style({
  display: 'grid',
  gridTemplateColumns: '1fr',
  gap: vars.space['4'],
  '@media': {
    [from('lg')]: {
      gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))',
    },
  },
});

/**
 * Said when the whole difference is accounted for by dates outside the period.
 *
 * Deliberately not a warning: nothing is wrong with the data, the two inputs
 * were simply read at different moments. It names the fix rather than the
 * symptom, because "re-export the statement" is a step the user can take and
 * "unexplained difference" is not.
 */
export const periodNotice = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space['1'],
  padding: `${vars.space['3']} ${vars.space['4']}`,
  borderRadius: vars.radius.sm,
  background: vars.color.info50,
  border: `${vars.border.hairline} solid ${vars.color.info200}`,
  fontSize: vars.font.sm,
  color: vars.color.info700,
});

/* ── Setup step ── */

/**
 * Centred in the step, not left-aligned against a wide modal.
 *
 * Step 1 is two fields in a full-screen dialog; pinned to the left edge they
 * read as the start of a longer form that never arrives.
 */
export const setupCard = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space['4'],
  width: '100%',
  maxWidth: '32rem',
  marginLeft: 'auto',
  marginRight: 'auto',
});

export const dropZone = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: vars.space['3'],
  padding: vars.space['12'],
  borderRadius: vars.radius.md,
  border: `${vars.border.thick} dashed ${vars.color.border}`,
  background: vars.color.surface,
  color: vars.color.textSecondary,
  fontSize: vars.font.base,
  cursor: 'pointer',
  transition: `border-color ${vars.duration.fast} ${vars.easing.default}, background ${vars.duration.fast} ${vars.easing.default}`,
  selectors: {
    '&:hover': {
      borderColor: vars.color.brand500,
      background: vars.color.surfaceRaised,
    },
    '&:focus-visible': {
      outline: 'none',
      borderColor: vars.focus.color,
      boxShadow: vars.focus.shadow,
    },
  },
});

export const hiddenInput = style({
  display: 'none',
});

/* ── Match groups ── */

export const groups = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space['6'],
});

export const group = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space['3'],
});

export const groupHeader = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space['1'],
});

/** Title and count share a line; the help text sits under them. */
export const groupHeadLine = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['2'],
});

/** Pushed to the far end of the heading, away from the title it qualifies. */
export const ignoreAll = style({
  marginLeft: 'auto',
});

export const groupTitle = style({
  fontSize: vars.font.lg,
  fontWeight: vars.font.semibold,
  color: vars.color.textPrimary,
});

export const groupHint = style({
  fontSize: vars.font.sm,
  color: vars.color.textTertiary,
});

/* ── Decision card ── */

export const decision = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space['2'],
});

/**
 * The rule between the two sides of a decision.
 *
 * A bordered `<td>` rather than a styled `<tr>`: a row's border collapses
 * against the cells inside it under `border-collapse: collapse`, so the line
 * has to be drawn by a cell that spans the table.
 */
export const decisionDivider = style({
  borderTop: `${vars.border.thin} solid ${vars.color.border}`,
  padding: '0',
  height: '0',
});

export const sideCell = style({
  paddingLeft: vars.space['2'],
  paddingRight: '0',
});

/**
 * The amount is the last column here, unlike the transaction log where an
 * actions column follows it. Without its own inset it sits hard against the
 * card's rounded edge.
 */
export const amountEdgeCell = style({
  paddingRight: vars.space['3'],
});

/**
 * Stacked, not columns.
 *
 * Three fields side by side made each one narrow enough to truncate the very
 * merchant names being corrected, and read as a row of unrelated inputs rather
 * than one transaction being edited.
 */
export const editFields = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space['4'],
});

/**
 * The decision's status, as a 32px icon badge.
 *
 * Background and foreground are set inline from the staged kind — a deletion
 * must not read like an acknowledgement, and colour is what makes a long list
 * scannable for the destructive decisions in it.
 */
export const statusBadge = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: vars.space['8'],
  height: vars.space['8'],
  borderRadius: vars.radius.full,
  flexShrink: 0,
});

export const decisionActions = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['2'],
  flexShrink: 0,
});

/**
 * The decision row, as the table's own last row.
 *
 * It belongs to the card rather than floating under it: the recommendation is
 * about the rows directly above, and separating them left it reading as page
 * furniture. Same treatment the dashboard gives its totals row — a rule across
 * the full width, then the summary.
 */
export const decisionFooterRow = style({
  borderTop: `${vars.border.thin} solid ${vars.color.border}`,
});

/**
 * The decision line's contents, inside the table cell that positions it.
 *
 * No insets of its own: the badge and text sit in real table cells now, so the
 * grid supplies the alignment. Padding here would only push them back off it.
 */
export const decisionFooter = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['3'],
  paddingRight: vars.space['2'],
  minHeight: '2.75rem',
});

/** A decision that has been made, shown where its recommendation was. */
export const stagedNote = style({
  flex: 1,
  minWidth: 0,
  fontSize: vars.font.base,
  fontWeight: vars.font.medium,
  color: vars.color.textPrimary,
});

export const recommendation = style({
  flex: 1,
  minWidth: 0,
  fontSize: vars.font.base,
  color: vars.color.textSecondary,
});

/* ── Review step ── */

/**
 * The name and budget fields, inside the card they belong to.
 *
 * A row of the decision's own table rather than a panel under it: the fields
 * describe the transaction shown directly above, and the two floated apart when
 * the card ended at the status line. Its own inset because it spans the table
 * and so inherits none of the cells' padding.
 */
export const reviewFieldsCell = style({
  padding: vars.space['4'],
  borderTop: `${vars.border.thin} solid ${vars.color.border}`,
});

export const reviewFields = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))',
  gap: vars.space['3'],
});

/** The per-row disclosure list under a merge: what each row will lose. */
export const mergeWarnings = style({
  listStyle: 'none',
  margin: 0,
  marginTop: vars.space['3'],
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space['2'],
});

export const mergeWarning = style({
  display: 'flex',
  alignItems: 'flex-start',
  gap: vars.space['2'],
  fontSize: vars.font.sm,
  color: vars.color.warning700,
});

/* ── Close modal ── */

export const closeBody = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space['4'],
});

export const closeSummary = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space['2'],
  padding: `${vars.space['3']} ${vars.space['4']}`,
  borderRadius: vars.radius.sm,
  background: vars.color.surfaceRaised,
  border: `${vars.border.hairline} solid ${vars.color.border}`,
});

export const closeRow = style({
  display: 'flex',
  justifyContent: 'space-between',
  gap: vars.space['4'],
  fontSize: vars.font.base,
});

export const closeWarning = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space['2'],
  padding: `${vars.space['3']} ${vars.space['4']}`,
  borderRadius: vars.radius.sm,
  background: vars.color.warning50,
  border: `${vars.border.hairline} solid ${vars.color.warning200}`,
  fontSize: vars.font.sm,
  color: vars.color.warning700,
});

/* ── Manual match candidates ── */

export const searchWrap = style({
  position: 'relative',
});

export const searchIcon = style({
  position: 'absolute',
  left: vars.space['3'],
  top: '50%',
  transform: 'translateY(-50%)',
  color: vars.color.textTertiary,
  pointerEvents: 'none',
});

export const candidateList = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space['1'],
  maxHeight: '18rem',
  overflowY: 'auto',
  listStyle: 'none',
  padding: '0',
  margin: '0',
});

export const candidate = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: vars.space['3'],
  width: '100%',
  padding: `${vars.space['2']} ${vars.space['3']}`,
  borderRadius: vars.radius.sm,
  border: `${vars.border.hairline} solid ${vars.color.border}`,
  background: vars.color.surface,
  textAlign: 'start',
  selectors: {
    '&:hover:not(:disabled)': {
      borderColor: vars.color.brand500,
      background: vars.color.surfaceRaised,
    },
  },
});

export const candidateMain = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space['0.5'],
  overflow: 'hidden',
  minWidth: 0,
});

export const candidateName = style({
  fontSize: vars.font.base,
  color: vars.color.textPrimary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const candidateMeta = style({
  fontSize: vars.font.sm,
  color: vars.color.textTertiary,
});

export const candidateAmount = style({
  fontFamily: vars.font.display,
  fontSize: vars.font.base,
  color: vars.color.textPrimary,
  flexShrink: 0,
});

/* ── Opening balance correction ── */

export const openingPreview = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space['1'],
  padding: `${vars.space['3']} ${vars.space['4']}`,
  borderRadius: vars.radius.sm,
  background: vars.color.info50,
  border: `${vars.border.hairline} solid ${vars.color.info200}`,
  fontSize: vars.font.sm,
  color: vars.color.info700,
});

/* ── Chosen file ── */

/**
 * A file, once chosen, is an object you can inspect and remove — not a label
 * swapped into the drop zone's helper text, which read as a state change too
 * subtle to notice.
 */
/**
 * White, unlike the drop zone it replaces.
 *
 * The zone is an invitation and sits back; the card is a chosen file and reads
 * as content, the same way a decision card does.
 */
export const fileCard = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['3'],
  padding: `${vars.space['3']} ${vars.space['4']}`,
  borderRadius: vars.radius.md,
  border: `${vars.border.hairline} solid ${vars.color.border}`,
  background: vars.color.neutral0,
});

export const fileIcon = style({
  color: vars.color.textTertiary,
  flexShrink: 0,
});

/**
 * Grows so the remove button is pushed to the card's right edge.
 *
 * `fileName` below already carries `flex: 1`, and it did nothing — because it
 * is not the flex child. The DS `Tooltip` wraps its trigger in a span of its
 * own, and THAT span is what `fileCard` lays out. The wrapper has no
 * flex-grow, so it sized to the filename and the button sat immediately beside
 * it instead of at the right edge.
 *
 * Same trap as the truncating-cell entry in ERRORS.md: a nested wrapper
 * swallows the layout property you set on the inner element. The fix is to put
 * the property on whatever is actually the flex child.
 *
 * `minWidth: 0` is what still lets the name truncate — without it a flex item
 * refuses to shrink below its content width and a long filename would push the
 * button back off the edge.
 */
export const fileNameWrap = style({
  flex: 1,
  minWidth: 0,
});

export const fileName = style({
  flex: 1,
  minWidth: 0,
  fontSize: vars.font.base,
  color: vars.color.textPrimary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

/** Keeps an arrow icon on the baseline between two values. */
export const periodRange = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: vars.space['2'],
});
