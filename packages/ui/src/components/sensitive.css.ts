import { style } from '@vanilla-extract/css';

/**
 * Styling for a masked value.
 *
 * There is deliberately no "masked" variant here any more. The redaction is a
 * SUBSTITUTION performed by `Sensitive` — when masked it renders `***` instead
 * of its children — so there is no real text to hide with CSS and no ancestor
 * class to key off. The earlier version painted a bar over the value, which
 * left the number in the DOM for devtools, selections and the accessibility
 * tree, and sized the bar to the text so the width leaked the magnitude.
 *
 * What remains is the one thing substitution does not give for free: stopping a
 * drag-select from lifting the asterisks into a paste, and keeping the glyphs
 * from being mistaken for typed content.
 */
export const sensitive = style({
  userSelect: 'none',
});
