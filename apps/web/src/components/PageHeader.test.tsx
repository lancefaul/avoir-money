import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PageHeader from './PageHeader.js';
import { useUIStore } from '../store/ui.js';

describe('PageHeader', () => {
  it('renders title into store', () => {
    render(<PageHeader title="Dashboard" />);
    expect(useUIStore.getState().pageTitle).toBe('Dashboard');
  });

  it('renders subtitle when provided', () => {
    render(<PageHeader title="Test" subtitle="Some info" />);
    expect(screen.getByText('Some info')).toBeInTheDocument();
  });

  it('does not render subtitle when not provided', () => {
    const { container } = render(<PageHeader title="Test" />);
    expect(container.querySelector('.text-gray-500')).toBeNull();
  });

  it('sets action in store when provided', () => {
    render(<PageHeader title="Test" action={<button type="button">Click</button>} />);
    expect(useUIStore.getState().pageAction).not.toBeNull();
  });

  it('sets page title in store', () => {
    render(<PageHeader title="My Title" />);
    expect(useUIStore.getState().pageTitle).toBe('My Title');
  });
});
