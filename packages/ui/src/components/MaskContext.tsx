import { createContext, useContext, type ReactNode } from 'react';

const MaskContext = createContext(false);

/**
 * Supplies the masked state to every `Sensitive` below it.
 *
 * A context rather than a CSS class on an ancestor, because the redaction
 * SUBSTITUTES the value instead of painting over it. Painting kept the real
 * text in the DOM, where a screenshot could not read it but devtools, a
 * text selection and an accessibility tree all could — and the painted bar was
 * as wide as the value it covered, so a six-figure balance stayed visibly
 * wider than a two-figure one. Substituting removes both problems: nothing
 * downstream ever receives the number, and every masked value is the same
 * three glyphs.
 */
export function MaskProvider({ masked, children }: { masked: boolean; children: ReactNode }) {
  return <MaskContext.Provider value={masked}>{children}</MaskContext.Provider>;
}

/**
 * Whether values should currently be hidden.
 *
 * Defaults to `false` with no provider, so a component rendered outside the app
 * shell — a test, the showcase, a future embed — shows real values rather than
 * silently redacting everything and looking broken.
 */
export function useMasked(): boolean {
  return useContext(MaskContext);
}
