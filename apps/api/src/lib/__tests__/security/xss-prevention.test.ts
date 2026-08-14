/**
 * XSS Prevention Tests
 *
 * Verifies that the API stores and returns HTML/script payloads as literal
 * strings without transformation, and that the frontend does not use
 * dangerouslySetInnerHTML.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { post, createAccount, createBudgetGroup, createBudget } from '../../../test/helpers.js';
import { XSS_PAYLOADS, HTML_ENTITY_PAYLOADS } from './payloads.js';

describe('XSS Prevention', () => {
  // ── Requirement 2.1: XSS payloads stored as literal strings ──

  describe('transaction creation with XSS payloads in note field', () => {
    it.each(XSS_PAYLOADS)(
      'stores XSS payload as literal string without transformation: %s',
      async (payload) => {
        const account = await createAccount();
        const res = await post('/transactions', {
          type: 'EXPENSE',
          name: 'XSS Test',
          amount: 10,
          date: new Date().toISOString(),
          accountId: account.id,
          note: payload,
        });

        expect(res.status).toBe(201);
        const body = (await res.json()) as any;
        // The API must store and return the payload as-is, no sanitization
        expect(body.note).toBe(payload);
      },
    );
  });

  // ── Requirement 2.2: HTML entity payloads in expense name ──

  describe('expense creation with HTML entity payloads in name', () => {
    it.each(HTML_ENTITY_PAYLOADS)('stores HTML entity payload as-is: %s', async (payload) => {
      const group = await createBudgetGroup();
      const budget = await createBudget(group.id);

      const res = await post('/expenses', {
        name: payload,
        amount: 50,
        frequency: 'MONTHLY',
        budgetId: budget.id,
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as any;
      expect(body.name).toBe(payload);
    });
  });

  // ── Requirement 2.3: No dangerouslySetInnerHTML in frontend ──

  describe('static analysis: no dangerouslySetInnerHTML', () => {
    it('zero .tsx files in apps/web/src/ contain dangerouslySetInnerHTML', () => {
      // Resolve the web src directory relative to this test file
      const webSrcDir = path.resolve(__dirname, '../../../../../../apps/web/src');
      const violations: string[] = [];

      function scanDir(dir: string): void {
        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanDir(fullPath);
          } else if (entry.isFile() && entry.name.endsWith('.tsx')) {
            const content = fs.readFileSync(fullPath, 'utf-8');
            if (/dangerouslySetInnerHTML/.test(content)) {
              violations.push(path.relative(webSrcDir, fullPath));
            }
          }
        }
      }

      scanDir(webSrcDir);
      expect(violations).toEqual([]);
    });
  });

  // ── Requirement 2.4: HTML tags pass Zod validation and are returned unchanged ──

  describe('string values with HTML tags pass Zod validation unchanged', () => {
    const htmlStrings = [
      '<b>bold</b>',
      '<script>alert(1)</script>',
      '<div class="test">content</div>',
      '<a href="javascript:void(0)">link</a>',
    ];

    it.each(htmlStrings)(
      'HTML string passes validation and is returned unchanged: %s',
      async (htmlPayload) => {
        const account = await createAccount();
        const res = await post('/transactions', {
          type: 'EXPENSE',
          name: 'HTML Tag Test',
          amount: 5,
          date: new Date().toISOString(),
          accountId: account.id,
          note: htmlPayload,
        });

        expect(res.status).toBe(201);
        const body = (await res.json()) as any;
        // Zod does not strip HTML — the value must be returned as-is
        expect(body.note).toBe(htmlPayload);
      },
    );
  });
});
