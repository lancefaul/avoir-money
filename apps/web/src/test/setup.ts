import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

/**
 * Mock @vanilla-extract/css so that .css.ts files can be imported in tests.
 * In the real build, vanilla-extract requires a file scope context that doesn't
 * exist in jsdom. These mocks make style(), createThemeContract(), etc. return
 * inert values (empty strings / deep proxies) so components render without error.
 */

function deepStringProxy(path = ''): any {
  return new Proxy(() => path, {
    get(_target, prop) {
      if (prop === Symbol.toPrimitive || prop === 'toString' || prop === 'valueOf')
        return () => path;
      if (typeof prop === 'symbol') return undefined;
      return deepStringProxy(path ? `${path}_${prop}` : prop);
    },
  });
}

vi.mock('@vanilla-extract/css', () => ({
  style: () => 'mock-style',
  styleVariants: (_base: any, _fn?: any) => new Proxy({}, { get: () => 'mock-variant' }),
  globalStyle: () => undefined,
  createThemeContract: (shape: any) => {
    // Return a deep proxy that returns empty strings for any property access
    return deepStringProxy();
  },
  createTheme: () => ['mock-theme-class', {}],
  createGlobalTheme: () => undefined,
  keyframes: () => 'mock-keyframes',
  fontFace: () => 'mock-fontface',
  createVar: () => 'mock-var',
  fallbackVar: () => 'mock-fallback-var',
  assignVars: () => ({}),
  createContainer: () => 'mock-container',
  layer: () => 'mock-layer',
  globalLayer: () => 'mock-global-layer',
  calc: { add: () => '', subtract: () => '', multiply: () => '', negate: () => '' },
}));

/**
 * Stub ResizeObserver for jsdom — used by DS components like Tabs.
 */
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any;
}

/**
 * Polyfill HTMLDialogElement methods for jsdom — showModal/close are not implemented.
 * Native <dialog> elements fire the `close` event on Escape key automatically;
 * we replicate that behavior here so tests can verify onClose callbacks.
 */
if (typeof HTMLDialogElement !== 'undefined') {
  HTMLDialogElement.prototype.showModal =
    HTMLDialogElement.prototype.showModal ||
    function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
      const handler = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && this.hasAttribute('open')) {
          this.close();
        }
      };
      (this as any).__escHandler = handler;
      document.addEventListener('keydown', handler);
    };
  HTMLDialogElement.prototype.close =
    HTMLDialogElement.prototype.close ||
    function (this: HTMLDialogElement) {
      this.removeAttribute('open');
      if ((this as any).__escHandler) {
        document.removeEventListener('keydown', (this as any).__escHandler);
        delete (this as any).__escHandler;
      }
      this.dispatchEvent(new Event('close'));
    };
  Object.defineProperty(HTMLDialogElement.prototype, 'open', {
    get() {
      return this.hasAttribute('open');
    },
    set(value: boolean) {
      if (value) this.setAttribute('open', '');
      else this.removeAttribute('open');
    },
    configurable: true,
  });
}
