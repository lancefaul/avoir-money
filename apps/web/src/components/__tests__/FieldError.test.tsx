import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import FieldError from '../FieldError.js';

describe('FieldError', () => {
  it('renders error message when error prop has a message', () => {
    render(<FieldError error={{ message: 'Name is required' }} />);

    expect(screen.getByText('Name is required')).toBeInTheDocument();
  });

  it('renders nothing when error prop is undefined', () => {
    const { container } = render(<FieldError />);

    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when error prop has no message', () => {
    const { container } = render(<FieldError error={{}} />);

    expect(container.innerHTML).toBe('');
  });
});
