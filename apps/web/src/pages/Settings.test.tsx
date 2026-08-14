import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createWrapper } from '../test/wrapper.js';

// Mock matchMedia for useIsNarrow in nested settings panels (import modal, sign conventions)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

import SettingsPage from './Settings.js';

describe('Settings Page', () => {
  it('renders the settings side nav with tabs', () => {
    render(<SettingsPage />, { wrapper: createWrapper() });
    expect(screen.getByRole('tab', { name: 'Backups' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Data Management' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Pay Schedule' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Theme' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Transactions' })).toBeInTheDocument();
  });
});
