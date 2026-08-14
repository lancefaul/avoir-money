import { useRef, useEffect } from 'react';

import { vars } from '@budget-tracker/ui/theme/contract.css.js';

interface LoadMoreTriggerProps {
  onLoadMore: () => void;
  hasMore: boolean;
  isFetching: boolean;
}

export function LoadMoreTrigger({ onLoadMore, hasMore, isFetching }: LoadMoreTriggerProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hasMore || isFetching) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) onLoadMore();
      },
      { rootMargin: '200px' },
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [hasMore, isFetching, onLoadMore]);

  return (
    <div
      ref={ref}
      style={{
        padding: `${vars.space['4']} 0`,
        textAlign: 'center',
        fontSize: vars.font.base,
        color: vars.color.textTertiary,
      }}
    >
      {isFetching && <span>Loading more transactions…</span>}
      {!hasMore && !isFetching && <span>All transactions loaded</span>}
    </div>
  );
}
