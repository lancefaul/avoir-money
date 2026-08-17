import type { ElementType, ReactNode } from 'react';
import { useMasked } from './MaskContext.js';
import * as s from './sensitive.css.js';

export interface SensitiveProps {
  children: ReactNode;
  /**
   * The element to render. Defaults to `span` because most masked values sit
   * inline inside a cell or a label; pass `div` when the value is a block and a
   * span would break the surrounding layout.
   */
  as?: ElementType;
  className?: string;
  /**
   * What this value is, for the audit. Never rendered — it exists so a failing
   * mask audit can name the thing it found rather than printing a coordinate.
   */
  label?: string;
}

/**
 * Every masked value renders as the same five glyphs, whatever it was.
 *
 * Exported because `Sensitive` cannot reach every case: a figure interpolated
 * into a prop string, or handed to a chart to draw into SVG, has to be replaced
 * BEFORE it is passed on. Those call sites used to hardcode the asterisks, which
 * put the glyph count in five places and meant changing it here would silently
 * leave them behind.
 */
export const REDACTED = '*****';

/**
 * Wraps a value that must not be readable when the app is masked.
 *
 * Use it for anything that identifies a person, an institution or an amount:
 * balances, transaction amounts, account and merchant names, budget names. Not
 * for structural text — a column header saying "Balance" discloses nothing, and
 * masking it makes the page unreadable rather than private.
 *
 * # Substitution, not concealment
 *
 * When masked this renders `***` INSTEAD of its children, so the real value is
 * never in the DOM. The first version painted a bar over the text with CSS,
 * which hid it from the screen and from a screenshot — but not from devtools,
 * a text selection, the accessibility tree, or a `textContent` read. It also
 * sized the bar to the text, so the width still leaked the magnitude of every
 * figure. Three fixed glyphs leak nothing and let a right-aligned amount column
 * stay right-aligned.
 *
 * The trade is a reflow when the mask turns on, since `***` is narrower than
 * most values. That is a deliberate reversal of the earlier "must not move"
 * rule: not moving was worth more than the width leak while the value stayed in
 * the DOM, and worth less than removing it entirely.
 *
 * The `data-sensitive` attribute is the contract the audit greps for, and it is
 * present in BOTH states — a value that renders without it is exactly the
 * failure this feature has to avoid, and the audit has to be able to see the
 * tag while the app is unmasked in order to say so.
 */
export function Sensitive({ children, as: Tag = 'span', className, label }: SensitiveProps) {
  const masked = useMasked();

  /*
   * Unmasked, this renders NOTHING of its own — no wrapper, no attribute, not
   * even a text-node boundary. That is deliberate and it is load-bearing twice
   * over.
   *
   * It keeps the unmasked DOM byte-identical to the DOM before this feature
   * existed, so wrapping 129 values could not change what any existing test or
   * any CSS selector sees. The first attempt did render a wrapper always, and
   * it broke 32 tests: `<span>+{amount}</span>` became `<span>+<span>{amount}
   * </span></span>`, and Testing Library's `getByText` reads only an element's
   * DIRECT text children, so `+$5,000.00` stopped matching. Syntax preserved,
   * observable behaviour changed — the scrubbing trap ADR-040 records.
   *
   * And it makes the audit honest. With no tag to find in the unmasked tree,
   * the audit cannot check tagging discipline; it has to render MASKED and
   * assert that nothing money-shaped survived. That is the property itself
   * rather than a proxy for it.
   */
  if (!masked) return <>{children}</>;

  return (
    <Tag
      className={className ? `${s.sensitive} ${className}` : s.sensitive}
      data-sensitive={label ?? ''}
      // Announce the redaction rather than reading three asterisks aloud.
      aria-label="hidden"
    >
      {REDACTED}
    </Tag>
  );
}
