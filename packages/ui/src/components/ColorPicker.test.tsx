import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ColorPicker } from './ColorPicker.js';

describe('ColorPicker', () => {
  it('renders with placeholder when no value', () => {
    render(<ColorPicker />);
    expect(screen.getByText('Pick a color…')).toBeInTheDocument();
  });

  it('renders custom placeholder', () => {
    render(<ColorPicker placeholder="Choose color" />);
    expect(screen.getByText('Choose color')).toBeInTheDocument();
  });

  it('shows selected color label when value is set', () => {
    render(<ColorPicker value="rose500" />);
    expect(screen.getByText('Rose 500')).toBeInTheDocument();
  });

  it('offers only swatch ids that actually exist in the theme contract', () => {
    // Regression, 2026-08-09. Renaming the data-viz hue families for the Avoir
    // palette silently emptied every swatch in this grid: the component resolves
    // `${hue}${shade}` through `vars.color as Record<string, string | undefined>`,
    // and that cast is precisely what stops `tsc` from seeing a missing key.
    // The same cast is used by six consumers to resolve a BudgetGroup's stored
    // colour, so a rename does not fail the build — it just stops painting.
    //
    // Both sides are read from SOURCE, and the contract side has to be: this
    // suite mocks `createThemeContract` with a proxy that answers every property
    // access, so at runtime `vars.color.anythingAtAll` is truthy and
    // `Object.keys(vars.color)` is empty. A test that asked the imported `vars`
    // whether a token exists would pass no matter what — the same blindness the
    // `as Record<…>` cast creates in the component.
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, 'ColorPicker.tsx'), 'utf8');
    const hues = src
      .slice(
        src.indexOf('const HUES = ['),
        src.indexOf('] as const;', src.indexOf('const HUES = [')),
      )
      .match(/'([a-zA-Z]+)'/g)!
      .map((s) => s.replace(/'/g, ''));
    const shades = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900'];

    const contract = readFileSync(join(here, '../theme/contract.css.ts'), 'utf8');
    const known = new Set([...contract.matchAll(/^\s+(\w+): null,/gm)].map((m) => m[1]!));

    expect(hues).toHaveLength(12);
    expect(known.size).toBeGreaterThan(100); // the parse found a contract, not an empty file
    const missing = hues.flatMap((h) => shades.map((s) => `${h}${s}`)).filter((k) => !known.has(k));
    expect(missing).toEqual([]);
  });

  it('opens dropdown on click', () => {
    render(<ColorPicker />);
    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('calls onChange when a swatch is clicked', () => {
    const onChange = vi.fn();
    render(<ColorPicker onChange={onChange} />);
    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);
    const swatch = screen.getByRole('option', { name: 'Rose 500' });
    fireEvent.click(swatch);
    expect(onChange).toHaveBeenCalledWith('rose500');
  });

  it('shows check icon on selected swatch', () => {
    render(<ColorPicker value="neutral900" />);
    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);
    const selected = screen.getByRole('option', { name: 'Neutral 900' });
    expect(selected).toHaveAttribute('aria-selected', 'true');
  });

  it('does not open when disabled', () => {
    render(<ColorPicker disabled />);
    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('hides label when showLabel is false', () => {
    render(<ColorPicker value="brand600" showLabel={false} />);
    expect(screen.queryByText('Brand 600')).not.toBeInTheDocument();
  });

  it('renders all three sections', () => {
    render(<ColorPicker />);
    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);
    // Should have neutral swatches and data viz swatches (no text labels)
    expect(screen.getByRole('option', { name: 'Neutral 900' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Rose 500' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Plum 50' })).toBeInTheDocument();
  });
});
