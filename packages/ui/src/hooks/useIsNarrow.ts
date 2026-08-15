import { useState, useEffect } from 'react';

/**
 * True when the viewport is at or below `maxWidth` (px).
 *
 * Guarded for environments without `matchMedia` (jsdom does not implement it),
 * where it resolves to `false` — i.e. the wide/desktop behavior, which is the
 * safe default for tests.
 */
export function useIsNarrow(maxWidth: number): boolean {
  const query = `(max-width: ${maxWidth}px)`;

  const [narrow, setNarrow] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia(query).matches,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent | MediaQueryList) => setNarrow(e.matches);
    handler(mq);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [query]);

  return narrow;
}
