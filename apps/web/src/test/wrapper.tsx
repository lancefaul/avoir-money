/**
 * Test wrapper providing QueryClient for page-level tests.
 * Also renders the pageAction from the UI store so action buttons
 * pushed via PageHeader are visible in the test DOM.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useUIStore } from '../store/ui.js';

function PageActionSlot() {
  const pageAction = useUIStore((s) => s.pageAction);
  return pageAction ? <div data-testid="page-action-slot">{pageAction}</div> : null;
}

export function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
        <PageActionSlot />
      </QueryClientProvider>
    );
  };
}
