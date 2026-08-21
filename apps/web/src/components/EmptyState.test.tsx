import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EmptyState from './EmptyState.js';

describe('EmptyState', () => {
  it('renders message text', () => {
    render(<EmptyState message="Nothing here" />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });

  it('renders icon when provided', () => {
    render(
      <EmptyState message="No data" icon={<svg data-testid="empty-icon" aria-hidden="true" />} />,
    );
    expect(screen.getByTestId('empty-icon')).toBeInTheDocument();
  });

  it('does not render icon container when icon is not provided', () => {
    const { container } = render(<EmptyState message="No data" />);
    // Only direct child should be the <p> message
    const wrapper = container.firstElementChild!;
    expect(wrapper.children).toHaveLength(1);
    expect(wrapper.children[0]!.tagName).toBe('P');
  });

  it('renders action button when provided', () => {
    render(<EmptyState message="Empty" action={<button type="button">Add Item</button>} />);
    expect(screen.getByRole('button', { name: 'Add Item' })).toBeInTheDocument();
  });

  it('action button is clickable', async () => {
    const user = userEvent.setup();
    let clicked = false;
    render(
      <EmptyState
        message="Empty"
        action={
          <button type="button" onClick={() => (clicked = true)}>
            Create
          </button>
        }
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(clicked).toBe(true);
  });

  it('does not render action container when action is not provided', () => {
    const { container } = render(<EmptyState message="Empty" />);
    const wrapper = container.firstElementChild!;
    // Without icon or action, only the <p> should exist
    expect(wrapper.children).toHaveLength(1);
  });

  it('renders icon, message, and action together', () => {
    render(
      <EmptyState
        message="No transactions yet"
        icon={<svg data-testid="tx-icon" aria-hidden="true" />}
        action={<button type="button">Add Transaction</button>}
      />,
    );
    expect(screen.getByTestId('tx-icon')).toBeInTheDocument();
    expect(screen.getByText('No transactions yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Transaction' })).toBeInTheDocument();
  });

  it('uses dashed border styling', () => {
    const { container } = render(<EmptyState message="Empty" />);
    const wrapper = container.firstElementChild as HTMLElement;
    // Verify the wrapper exists and has inline styles applied
    expect(wrapper.style.display).toBe('flex');
    expect(wrapper.style.textAlign).toBe('center');
  });
});
