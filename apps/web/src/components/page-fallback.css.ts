import { style } from '@vanilla-extract/css';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';

/**
 * Padding for anything that replaces a page's content on a SUBNAV route.
 *
 * `Layout.tsx` sets `padding: 0` for `/settings`, `/healthcare`, `/investments`,
 * `/utilities` and `/accounts`, because on those routes the `Tabs` component
 * supplies padding inside each panel. That is correct for the populated view and
 * wrong for everything else: an empty state rendered when there are no tabs to
 * show, or an error boundary that has replaced the whole page, is not inside a
 * panel and gets nothing. Both then sit flush against the viewport edge while
 * every other page has a comfortable margin.
 *
 * One style rather than a padding at each call site, because the sites are not
 * obviously related to each other — an empty state in Utilities, an empty state
 * in Settings, an error boundary in `router.tsx` — and the next one will be
 * written by someone who has not seen the other three.
 *
 * Matches `Layout.tsx`'s non-subnav padding exactly. If that changes, this
 * changes with it, which is the reason it names the same token rather than a
 * value that happens to agree today.
 */
export const pageFallback = style({
  padding: vars.space['4'],
});
