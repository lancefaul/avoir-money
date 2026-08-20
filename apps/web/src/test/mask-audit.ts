/**
 * Finds money that would still be readable with the mask on.
 *
 * # Why this exists rather than a checklist
 *
 * Masking is applied by TAGGING values with `Sensitive`, and tagging is a pass
 * somebody performs by reading the code. That is the same shape as the
 * publication sweep, which reported ✓ on two real merchants for four
 * publications because a check can only find what it enumerates. The failure
 * here is worse than that one: an incomplete mask does not merely miss
 * something, it implies a safety it does not provide, and the user finds out by
 * being read over the shoulder.
 *
 * So the tagging pass is not trusted. This walks the rendered DOM and reports
 * every currency-shaped string that is NOT inside a `[data-sensitive]`
 * ancestor. A value added later, by someone who has never heard of this
 * feature, fails a test instead of leaking.
 *
 * # What it deliberately cannot check
 *
 * Names. "Fidelity Cash Management" and "Statement period" are both prose and
 * no pattern separates them, so identifying TEXT is covered by the tagging pass
 * and by review, not by this. Stated here rather than left to be discovered:
 * a green audit means no unmasked AMOUNTS, not a private screen.
 */

/**
 * Matches what this app actually renders for money: `$1,234.56`, `-$20.00`,
 * `$0.00`, and the compact forms `$10.00k` / `$1.20m`.
 *
 * Anchored on the currency symbol rather than on digits, because bare digits
 * are dates, counts, percentages and ids — matching those would make the audit
 * noisy, and a noisy audit gets disabled, which is how a guardrail dies.
 */
const CURRENCY = /-?\$\s?-?[\d,]+(\.\d{2})?[km]?/i;

export interface MaskLeak {
  text: string;
  /** The nearest element with a class or test id, to make the report actionable. */
  where: string;
}

function describeElement(el: Element | null): string {
  if (!el) return '(detached)';
  const testId = el.getAttribute('data-testid');
  if (testId) return `[data-testid="${testId}"]`;
  const cls = el.getAttribute('class');
  return cls ? `${el.tagName.toLowerCase()}.${cls.split(/\s+/)[0]}` : el.tagName.toLowerCase();
}

/**
 * Every currency-shaped string in `root` that the mask would not cover.
 *
 * Call it on a tree rendered with the mask ON. An empty array is the pass.
 */
export function findMaskLeaks(root: HTMLElement): MaskLeak[] {
  const leaks: MaskLeak[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = (node.textContent ?? '').trim();
    if (!text || !CURRENCY.test(text)) continue;

    // `closest` walks up through ancestors, which is the whole point: a value
    // is covered by a tag anywhere above it, not only on its own element.
    const parent = node.parentElement;
    if (parent?.closest('[data-sensitive]')) continue;

    leaks.push({ text, where: describeElement(parent) });
  }
  return leaks;
}

/** Formats leaks for an assertion message that names what to go and tag. */
export function formatMaskLeaks(leaks: MaskLeak[]): string {
  return leaks.map((l) => `  ${l.text}  in ${l.where}`).join('\n');
}
