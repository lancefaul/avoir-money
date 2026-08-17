import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ToastContainer from './ToastContainer.js';
import { useToastStore } from '../store/toast.js';

describe('ToastContainer', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when there are no toasts', () => {
    const { container } = render(<ToastContainer />);
    // Container returns null when no toasts
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0);
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(0);
  });

  it('renders a success toast with the correct message', () => {
    act(() => useToastStore.getState().addToast('success', 'Saved!'));
    render(<ToastContainer />);
    expect(screen.getByText('Saved!')).toBeInTheDocument();
  });

  it('renders an error toast with the correct message', () => {
    act(() => useToastStore.getState().addToast('error', 'Something failed'));
    render(<ToastContainer />);
    expect(screen.getByText('Something failed')).toBeInTheDocument();
  });

  it('renders a warning toast with the correct message', () => {
    act(() => useToastStore.getState().addToast('warning', 'Be careful'));
    render(<ToastContainer />);
    expect(screen.getByText('Be careful')).toBeInTheDocument();
  });

  it('renders an info toast with the correct message', () => {
    act(() => useToastStore.getState().addToast('info', 'FYI'));
    render(<ToastContainer />);
    expect(screen.getByText('FYI')).toBeInTheDocument();
  });

  it('stacks multiple toasts', () => {
    act(() => {
      useToastStore.getState().addToast('success', 'First');
      useToastStore.getState().addToast('error', 'Second');
      useToastStore.getState().addToast('info', 'Third');
    });
    render(<ToastContainer />);
    // The DS ToastContainer renders the front toast with its role
    // and behind toasts are aria-hidden. All toast titles should be present.
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
    expect(screen.getByText('Third')).toBeInTheDocument();
  });

  it('auto-dismisses success toasts after the duration elapses', async () => {
    // The DS Toast uses requestAnimationFrame for auto-dismiss, so we use real timers
    act(() => useToastStore.getState().addToast('success', 'Gone soon', { duration: 100 }));
    render(<ToastContainer />);
    expect(screen.getByText('Gone soon')).toBeInTheDocument();

    // Wait for auto-dismiss (duration + exit animation)
    await waitFor(
      () => {
        expect(useToastStore.getState().toasts).toHaveLength(0);
      },
      { timeout: 1000 },
    );
  });

  it('auto-dismisses info toasts after the duration elapses', async () => {
    act(() => useToastStore.getState().addToast('info', 'Temporary', { duration: 100 }));
    render(<ToastContainer />);

    await waitFor(
      () => {
        expect(useToastStore.getState().toasts).toHaveLength(0);
      },
      { timeout: 1000 },
    );
  });

  it('does NOT auto-dismiss error toasts', async () => {
    act(() => useToastStore.getState().addToast('error', 'Persistent'));
    render(<ToastContainer />);

    // Wait a bit and verify it's still there
    await new Promise((r) => setTimeout(r, 300));
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it('does NOT auto-dismiss warning toasts', async () => {
    act(() => useToastStore.getState().addToast('warning', 'Stays'));
    render(<ToastContainer />);

    await new Promise((r) => setTimeout(r, 300));
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it('shows a close button on error toasts for manual dismissal', async () => {
    const user = userEvent.setup();
    act(() => useToastStore.getState().addToast('error', 'Dismiss me'));
    render(<ToastContainer />);

    // The DS Toast renders an IconButton with tooltip="Dismiss"
    const closeBtn = screen.getByRole('button', { name: 'Dismiss' });
    await user.click(closeBtn);

    await waitFor(() => {
      expect(useToastStore.getState().toasts).toHaveLength(0);
    });
  });

  it('shows a close button on warning toasts for manual dismissal', async () => {
    const user = userEvent.setup();
    act(() => useToastStore.getState().addToast('warning', 'Close me'));
    render(<ToastContainer />);

    const closeBtn = screen.getByRole('button', { name: 'Dismiss' });
    await user.click(closeBtn);

    await waitFor(() => {
      expect(useToastStore.getState().toasts).toHaveLength(0);
    });
  });

  it('shows a close button on success toasts too (all toasts have dismiss)', () => {
    act(() => useToastStore.getState().addToast('success', 'Auto only'));
    render(<ToastContainer />);

    // The DS Toast always renders a dismiss button on all toasts
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });

  it('shows a close button on info toasts too (all toasts have dismiss)', () => {
    act(() => useToastStore.getState().addToast('info', 'Auto only'));
    render(<ToastContainer />);

    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });

  it('uses role="alert" for error toasts', () => {
    act(() => useToastStore.getState().addToast('error', 'Error toast'));
    render(<ToastContainer />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('uses role="status" for success toasts', () => {
    act(() => useToastStore.getState().addToast('success', 'Success toast'));
    render(<ToastContainer />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
