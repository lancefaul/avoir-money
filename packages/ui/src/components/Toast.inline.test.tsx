/**
 * Toast rendered *in* the page rather than floating over it.
 *
 * `flat` and `fullWidth` exist for that case: shadow is elevation, and an
 * inline notice has none, while the fixed 22rem width only exists to align a
 * corner stack and reads as a floating card inside a wide column.
 *
 * The shared UI setup mocks every vanilla-extract `style()` to the same
 * `'mock-style'` string, which would make these two classes indistinguishable
 * from the base one. So this file scopes a mock over just `toast.css.js` —
 * the same approach the DatePicker phase-class tests use — and keeps every
 * other component's styling untouched.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('./toast.css.js', () => {
  // Returned as a Proxy rather than a spread object: a Proxy with only a `get`
  // trap has no own keys, so spreading it produces nothing and every other
  // style export (header, icon, title…) comes back undefined.
  const named: Record<string, unknown> = {
    toast: 'toast',
    toastFlat: 'toast-flat',
    toastFullWidth: 'toast-full-width',
    toastEnterBottom: 'enter-bottom',
    toastEnterTop: 'enter-top',
    toastExit: 'exit',
    toastFilled: new Proxy({}, { get: (_t, p) => `filled-${String(p)}` }),
    toastNotification: 'notification',
    iconColor: new Proxy({}, { get: (_t, p) => `icon-${String(p)}` }),
  };
  return new Proxy(named, {
    get: (target, prop) => {
      if (typeof prop === 'symbol') return undefined;
      return prop in target ? target[prop as string] : String(prop);
    },
    has: () => true,
  });
});

const { Toast } = await import('./Toast.js');

function renderToast(props: Record<string, unknown> = {}) {
  render(
    <Toast
      id="t1"
      severity="info"
      title="Stock values are showing their last recorded figures."
      autoDismiss={false}
      onDismiss={() => {}}
      {...props}
    />,
  );
  return screen.getByRole('status');
}

describe('Toast — inline props', () => {
  it('keeps its shadow by default', () => {
    expect(renderToast()).not.toHaveClass('toast-flat');
  });

  it('drops the shadow when flat', () => {
    expect(renderToast({ flat: true })).toHaveClass('toast-flat');
  });

  it('keeps the fixed stack width by default', () => {
    expect(renderToast()).not.toHaveClass('toast-full-width');
  });

  it('fills its container when fullWidth', () => {
    expect(renderToast({ fullWidth: true })).toHaveClass('toast-full-width');
  });

  it('composes both with the severity variant rather than replacing it', () => {
    // The classes are orthogonal: an inline toast still has to look like its
    // severity, or `flat` would quietly cost the filled background.
    const el = renderToast({ flat: true, fullWidth: true, variant: 'filled' });

    expect(el).toHaveClass('toast');
    expect(el).toHaveClass('toast-flat');
    expect(el).toHaveClass('toast-full-width');
    expect(el).toHaveClass('filled-info');
  });

  it('accepts a node title so a message can carry an inline icon', () => {
    renderToast({
      title: (
        <span>
          Settings <svg data-testid="chevron" /> Connected Services
        </span>
      ),
    });

    // Previously typed as `string`, which made an inline icon impossible.
    expect(screen.getByTestId('chevron')).toBeInTheDocument();
  });

  it('renders no dismiss control when customActions is empty', () => {
    // For a notice whose condition decides when it goes away, not the reader.
    renderToast({ customActions: <></> });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
