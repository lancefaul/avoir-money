import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PageErrorBoundary from '../PageErrorBoundary.js';

// A child component that throws on demand
let shouldThrow = true;
const testError = new Error('Render kaboom');

function ThrowingChild() {
  if (shouldThrow) {
    throw testError;
  }
  return <div>Child rendered OK</div>;
}

describe('PageErrorBoundary', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    shouldThrow = true;
    // Suppress noisy error boundary output in test logs
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('renders children when no error occurs', () => {
    shouldThrow = false;
    render(
      <PageErrorBoundary pageName="Dashboard">
        <div>All good</div>
      </PageErrorBoundary>,
    );

    expect(screen.getByText('All good')).toBeInTheDocument();
  });

  it('renders fallback UI with page name and retry button on error', () => {
    render(
      <PageErrorBoundary pageName="Expenses">
        <ThrowingChild />
      </PageErrorBoundary>,
    );

    expect(screen.getByText('Expenses')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('calls console.error with the error and component stack', () => {
    render(
      <PageErrorBoundary pageName="Income">
        <ThrowingChild />
      </PageErrorBoundary>,
    );

    // componentDidCatch should have called console.error
    const matchingCall = consoleErrorSpy.mock.calls.find(
      (args: unknown[]) =>
        typeof args[0] === 'string' &&
        args[0].includes('[Income]') &&
        args[1] === testError &&
        typeof args[2] === 'string', // component stack is a string
    );
    expect(matchingCall).toBeDefined();
  });

  it('resets error state and re-renders children on retry', async () => {
    const user = userEvent.setup();

    render(
      <PageErrorBoundary pageName="Accounts">
        <ThrowingChild />
      </PageErrorBoundary>,
    );

    // Fallback is showing
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    // Stop throwing so the next render succeeds
    shouldThrow = false;

    await user.click(screen.getByRole('button', { name: /try again/i }));

    // Children should now render successfully
    expect(screen.getByText('Child rendered OK')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });
});
