import '@testing-library/jest-dom/vitest';

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
  createThemeContract: (shape: any) => deepStringProxy(),
  createTheme: () => ['mock-theme-class', {}],
  createGlobalTheme: () => undefined,
  keyframes: () => 'mock-keyframes',
  globalKeyframes: () => undefined,
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
 * Stub ResizeObserver for jsdom — used by DS components like Tabs and DatePicker.
 */
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any;
}

/**
 * Stub matchMedia for jsdom — it does not implement it. Used by the responsive
 * collapse in Tabs (icon-only tabs below 640px). Reports `matches: false`, so
 * components render their wide/default layout under test.
 */
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

/**
 * Create #tooltip-portal element for components that use createPortal
 * (Tooltip, Toggletip, Modal, DropdownMenu, DatePicker).
 */
if (!document.getElementById('tooltip-portal')) {
  const portal = document.createElement('div');
  portal.id = 'tooltip-portal';
  document.body.appendChild(portal);
}
