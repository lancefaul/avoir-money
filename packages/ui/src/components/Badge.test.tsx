import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { Badge } from './Badge.js';

describe('Badge', () => {
  it('renders its children', () => {
    render(<Badge>Hello</Badge>);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('is a plain, non-interactive span by default', () => {
    const { container } = render(<Badge>Plain</Badge>);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    // no chevron icon
    expect(container.querySelector('svg')).toBeNull();
  });

  describe('chevron (dropdown-trigger mode)', () => {
    it('renders a trailing chevron and button semantics', () => {
      const { container } = render(<Badge chevron>Food</Badge>);
      const badge = screen.getByRole('button', { name: 'Food' });
      expect(badge).toHaveAttribute('tabindex', '0');
      // the ChevronDown icon is present (and aria-hidden, so name stays "Food")
      expect(container.querySelector('svg')).not.toBeNull();
    });

    it('forwards injected trigger props onto its root (asChild-compatible)', async () => {
      const user = userEvent.setup();
      const onClick = vi.fn();
      render(
        <Badge chevron onClick={onClick} aria-haspopup="menu" aria-expanded={false}>
          Trigger
        </Badge>,
      );
      const badge = screen.getByRole('button', { name: 'Trigger' });
      expect(badge).toHaveAttribute('aria-haspopup', 'menu');
      await user.click(badge);
      expect(onClick).toHaveBeenCalledTimes(1);
    });
  });

  it('forwards a ref to its root element', () => {
    const ref = createRef<HTMLSpanElement>();
    render(<Badge ref={ref}>Ref</Badge>);
    expect(ref.current).toBeInstanceOf(HTMLSpanElement);
  });

  it('applies a custom background over the variant', () => {
    render(
      <Badge variant="neutral" background="rgb(1, 2, 3)">
        Colored
      </Badge>,
    );
    expect(screen.getByText('Colored')).toHaveStyle({ background: 'rgb(1, 2, 3)' });
  });
});
