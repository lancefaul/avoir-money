/**
 * The app has ONE mark, and every surface shows it.
 *
 * On 2026-08-12 the launcher showed the current mark while the running window
 * and its launch feedback showed a retired one. Every icon file on the machine
 * was byte-identical and current — the odd one out was `index.html`'s favicon,
 * still pointing at the rounded-square serif A.
 *
 * That is not a browser-tab detail. **Chromium sets the window icon from the
 * page favicon when the page provides one**, so in the desktop app the favicon
 * overrides the icon the Electron shell passes to `BrowserWindow`. One stale
 * `<link rel="icon">` is enough to make the whole desktop presentation wrong
 * while every PNG on disk is right — which is exactly why it survived a
 * package removal, three cache rebuilds and two plasmashell restarts.
 *
 * Asserting the two agree, rather than hard-coding a filename, is the point:
 * changing the mark in one place and not the other is the failure, and a test
 * that merely restates one of them would not notice.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '../../..');

const read = (rel: string) => readFileSync(path.join(webRoot, rel), 'utf8');

/** The `src` the brand components render. */
function markUsedInApp(): string {
  const titleBar = read('src/components/TitleBar.tsx');
  const match = /<img\s+src="(\/[^"]+\.png)"/.exec(titleBar);
  expect(match?.[1], 'TitleBar should render an <img> mark').toBeTypeOf('string');
  return match![1]!;
}

describe('the brand mark', () => {
  it('is the same asset in the favicon and the title bar', () => {
    const favicon = /<link\s+rel="icon"\s+href="([^"]+)"/.exec(read('index.html'));
    expect(favicon, 'index.html should declare a favicon').not.toBeNull();
    expect(favicon![1]).toBe(markUsedInApp());
  });

  it('is the same asset in the favicon and the sidebar lockup', () => {
    const layout = read('src/components/Layout.tsx');
    const brand = /brandIcon = <img src="(\/[^"]+\.png)"/.exec(layout);
    expect(brand, 'Layout should render a brand icon').not.toBeNull();
    expect(brand![1]).toBe(markUsedInApp());
  });

  it('the referenced file exists', () => {
    // A favicon pointing at a missing file fails silently — the browser simply
    // shows nothing, and in the desktop app the window icon falls back to a
    // stock image with no error anywhere.
    expect(() => read(path.join('public', markUsedInApp().replace(/^\//, '')))).not.toThrow();
  });
});
