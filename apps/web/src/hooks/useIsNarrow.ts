import { useState, useEffect } from 'react';

/**
 * Returns true when the viewport is at or below `breakpoint` pixels wide.
 * Used for responsive layout decisions that require conditional rendering
 * (real DOM changes), not just CSS visibility — e.g. collapsing table
 * columns or moving controls between the header and the page body.
 */
export function useIsNarrow(breakpoint: number): boolean {
  const [isNarrow, setIsNarrow] = useState(
    () =>
      typeof window !== 'undefined' && window.matchMedia(`(max-width: ${breakpoint}px)`).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const handler = (e: MediaQueryListEvent | MediaQueryList) => setIsNarrow(e.matches);
    handler(mq);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [breakpoint]);
  return isNarrow;
}
