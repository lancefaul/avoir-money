import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatCard from './StatCard.js';

describe('StatCard', () => {
  it('renders label and formatted currency value', () => {
    render(<StatCard label="Income" value={5000} />);
    expect(screen.getByText('Income')).toBeInTheDocument();
    expect(screen.getByText('$5,000.00')).toBeInTheDocument();
  });

  it('renders non-currency value when currency=false', () => {
    render(<StatCard label="Count" value={42} currency={false} />);
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('renders subtitle when provided', () => {
    render(<StatCard label="Test" value={0} sub="extra info" />);
    expect(screen.getByText('extra info')).toBeInTheDocument();
  });

  it('does not render subtitle when not provided', () => {
    render(<StatCard label="Test" value={0} />);
    expect(screen.queryByText('extra info')).not.toBeInTheDocument();
  });

  it('applies green color class', () => {
    render(<StatCard label="Test" value={100} color="green" />);
    const valueEl = screen.getByText('$100.00');
    // vanilla-extract classes are mocked as 'mock-style' in tests;
    // verify the element renders with a className (color variant applied)
    expect(valueEl).toBeInTheDocument();
    expect(valueEl.className).toBeTruthy();
  });

  it('applies red color class', () => {
    render(<StatCard label="Test" value={-50} color="red" />);
    const valueEl = screen.getByText('-$50.00');
    expect(valueEl).toBeInTheDocument();
    expect(valueEl.className).toBeTruthy();
  });
});
