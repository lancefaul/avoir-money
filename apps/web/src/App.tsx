import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { router } from './router.js';
import { createMutationCache } from './lib/mutation-observer.js';

// Annotated because the cache is built with a thunk back to the client that
// owns it — a genuine cycle, which inference cannot resolve on its own.
const queryClient: QueryClient = new QueryClient({
  mutationCache: createMutationCache(() => queryClient),
  defaultOptions: { queries: { staleTime: Infinity, retry: 1 } },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
