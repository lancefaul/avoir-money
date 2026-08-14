import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoadMoreTrigger } from './LoadMoreTrigger.js';

// Mock IntersectionObserver as a class so `new IntersectionObserver(...)` works
let observerCallback: IntersectionObserverCallback;
let observerInstance: {
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  unobserve: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  observerInstance = { observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() };
  const MockIntersectionObserver = vi.fn(function (this: any, cb: IntersectionObserverCallback) {
    observerCallback = cb;
    Object.assign(this, observerInstance);
  });
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
});

describe('LoadMoreTrigger', () => {
  it('shows "Loading more transactions…" when isFetching is true', () => {
    render(<LoadMoreTrigger onLoadMore={vi.fn()} hasMore={true} isFetching={true} />);
    expect(screen.getByText('Loading more transactions…')).toBeInTheDocument();
  });

  it('shows "All transactions loaded" when hasMore is false and isFetching is false', () => {
    render(<LoadMoreTrigger onLoadMore={vi.fn()} hasMore={false} isFetching={false} />);
    expect(screen.getByText('All transactions loaded')).toBeInTheDocument();
  });

  it('does not show any status text when hasMore is true and not fetching', () => {
    render(<LoadMoreTrigger onLoadMore={vi.fn()} hasMore={true} isFetching={false} />);
    expect(screen.queryByText('Loading more transactions...')).not.toBeInTheDocument();
    expect(screen.queryByText('All transactions loaded')).not.toBeInTheDocument();
  });

  it('does NOT call onLoadMore when hasMore is false', () => {
    const onLoadMore = vi.fn();
    render(<LoadMoreTrigger onLoadMore={onLoadMore} hasMore={false} isFetching={false} />);

    // Observer should not be created when hasMore is false
    // The effect returns early, so no observer.observe call
    expect(observerInstance.observe).not.toHaveBeenCalled();

    // Even if we simulate intersection, onLoadMore should not fire
    // because the observer was never set up
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('does NOT set up observer when isFetching is true', () => {
    render(<LoadMoreTrigger onLoadMore={vi.fn()} hasMore={true} isFetching={true} />);
    expect(observerInstance.observe).not.toHaveBeenCalled();
  });

  it('calls onLoadMore when element is intersecting and hasMore is true', () => {
    const onLoadMore = vi.fn();
    render(<LoadMoreTrigger onLoadMore={onLoadMore} hasMore={true} isFetching={false} />);

    // Observer should have been set up
    expect(observerInstance.observe).toHaveBeenCalled();

    // Simulate intersection
    observerCallback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onLoadMore when element is not intersecting', () => {
    const onLoadMore = vi.fn();
    render(<LoadMoreTrigger onLoadMore={onLoadMore} hasMore={true} isFetching={false} />);

    // Simulate non-intersection
    observerCallback(
      [{ isIntersecting: false } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );

    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('disconnects observer on unmount', () => {
    const { unmount } = render(
      <LoadMoreTrigger onLoadMore={vi.fn()} hasMore={true} isFetching={false} />,
    );
    unmount();
    expect(observerInstance.disconnect).toHaveBeenCalled();
  });

  it('creates observer with 200px rootMargin', () => {
    render(<LoadMoreTrigger onLoadMore={vi.fn()} hasMore={true} isFetching={false} />);
    expect(IntersectionObserver).toHaveBeenCalledWith(expect.any(Function), {
      rootMargin: '200px',
    });
  });
});
