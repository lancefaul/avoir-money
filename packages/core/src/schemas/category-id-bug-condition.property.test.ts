/**
 * Bug Condition Exploration Test — categoryId → budgetId rename
 *
 * Property 1: Bug Condition — API Layer Uses categoryId Instead of budgetId
 *
 * This test encodes the EXPECTED behavior: all API schemas should use `budgetId`
 * (matching the database column), not `categoryId`. It is expected to FAIL on
 * unfixed code, proving the bug exists. After the fix, it should PASS.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { TransactionSchema, CreateTransactionSchema } from './transaction.js';
import { ExpenseSchema } from './expense.js';
import { IncomeSchema } from './income.js';
import { BudgetGoalSchema } from './goal.js';
import { ChildTransactionSchema } from './child-transaction.js';
import { AnticipationSchema as AnticipationSchemaImport } from './anticipation.js';

// ─── Helper: read source file content ───

function readSourceFile(relativePath: string): string {
  const fullPath = path.resolve(__dirname, relativePath);
  return fs.readFileSync(fullPath, 'utf-8');
}

// ─── Helper: read file relative to project root ───

function readProjectFile(relativePath: string): string {
  // Navigate from packages/core/src/schemas/ up to project root
  const projectRoot = path.resolve(__dirname, '../../../../');
  const fullPath = path.join(projectRoot, relativePath);
  return fs.readFileSync(fullPath, 'utf-8');
}

describe('Property 1: Bug Condition — API Layer Uses budgetId Consistently', () => {
  /**
   * **Validates: Requirements 1.1, 1.2, 1.8**
   *
   * Scoped PBT: For each schema file that references budget assignments,
   * verify that the Zod schema definitions use `budgetId` (not `categoryId`).
   *
   * This is a deterministic bug, so we scope the property to the concrete
   * failing cases (the specific schema files known to use categoryId).
   */
  describe('Schema Inspection — schemas use budgetId, not categoryId', () => {
    const schemaFiles = [
      { file: './transaction.ts', description: 'TransactionSchema, CreateTransactionSchema' },
      {
        file: './expense.ts',
        description: 'ExpenseSchema, CreateExpenseSchema, ListExpensesQuerySchema',
      },
      {
        file: './income.ts',
        description: 'IncomeSchema, CreateIncomeSchema, ListIncomeQuerySchema',
      },
      { file: './goal.ts', description: 'GoalSchema, CreateGoalSchema' },
      {
        file: './child-transaction.ts',
        description: 'ChildTransactionSchema, CreateChildTransactionSchema',
      },
      {
        file: './budget.ts',
        description: 'CreateCategoryBudgetSchema, CategoryBudgetResponseSchema',
      },
      { file: './anticipation.ts', description: 'AnticipationSchema' },
      {
        file: './dashboard.ts',
        description:
          'YTDCategoryBreakdown, BudgetBreakdownItemSchema, IncomeLineItem, ExpenseLineItem',
      },
    ];

    it('no schema file should define categoryId as a Zod field for budget references', () => {
      fc.assert(
        fc.property(fc.constantFrom(...schemaFiles), ({ file, description }) => {
          const content = readSourceFile(file);

          // The field name `categoryId` should NOT appear as a Zod schema field definition.
          // We look for patterns like `categoryId: z.string()` which indicate the bug.
          // We exclude comments and string literals that merely reference the concept.
          const zodFieldPattern = /^\s*categoryId\s*:/gm;
          const matches = content.match(zodFieldPattern);

          expect(matches).toBeNull();
        }),
        { numRuns: schemaFiles.length },
      );
    });

    it('transfer schema should use feeBudgetId, not feeCategoryId', () => {
      const content = readSourceFile('./transfer.ts');

      const feeCategoryIdPattern = /^\s*feeCategoryId\s*:/gm;
      const matches = content.match(feeCategoryIdPattern);

      expect(matches).toBeNull();
    });
  });

  /**
   * **Validates: Requirements 1.3, 1.4**
   *
   * Scoped PBT: Verify that route handlers do NOT contain remapping logic
   * that translates categoryId → budgetId on write paths.
   */
  describe('Route Handler Inspection — no categoryId → budgetId remapping', () => {
    const routeFiles = [
      { file: 'apps/api/src/routes/transactions.ts', description: 'Transaction create/update' },
      { file: 'apps/api/src/routes/expenses.ts', description: 'Expense create/update' },
      { file: 'apps/api/src/routes/income.ts', description: 'Income create/update' },
      { file: 'apps/api/src/routes/goals.ts', description: 'Goal create/update' },
      {
        file: 'apps/api/src/routes/transactions.children.ts',
        description: 'Child transaction create/update',
      },
      { file: 'apps/api/src/routes/category-budgets.ts', description: 'Category budget create' },
    ];

    it('route handlers should not contain categoryId-to-budgetId remapping logic', () => {
      fc.assert(
        fc.property(fc.constantFrom(...routeFiles), ({ file, description }) => {
          const content = readProjectFile(file);

          // Look for the destructuring remapping pattern:
          // `const { categoryId, ...rest }` or `const { categoryId: someName, ...rest }`
          // These indicate manual remapping from API schema to database field.
          const remapPattern = /\bcategoryId\b.*\bbudgetId\b/g;
          const destructurePattern = /{\s*categoryId\s*[:,]/g;

          const remapMatches = content.match(remapPattern);
          const destructureMatches = content.match(destructurePattern);

          // Neither remapping comments nor destructuring should exist
          expect(remapMatches).toBeNull();
          expect(destructureMatches).toBeNull();
        }),
        { numRuns: routeFiles.length },
      );
    });
  });

  /**
   * **Validates: Requirements 1.4**
   *
   * Scoped PBT: Verify that serialization functions do NOT contain remapping
   * logic that translates budgetId → categoryId on read paths.
   */
  describe('Serialization Inspection — no budgetId → categoryId remapping', () => {
    it('serializeTransaction should not remap budgetId to categoryId', () => {
      const content = readProjectFile('apps/api/src/lib/transaction-serialization.ts');

      // The serialization function should return budgetId directly,
      // not remap it to categoryId.
      // Look for `categoryId:` in the return object (indicates remapping).
      const categoryIdAssignment = /categoryId\s*:/g;
      const matches = content.match(categoryIdAssignment);

      expect(matches).toBeNull();
    });
  });

  /**
   * **Validates: Requirements 1.1, 1.2**
   *
   * Verify that the Zod schemas actually accept `budgetId` and that
   * `categoryId` is not a recognized field.
   */
  describe('Schema Runtime Validation — budgetId accepted, categoryId rejected', () => {
    it('TransactionSchema should have budgetId field, not categoryId', () => {
      const shape = TransactionSchema.shape;

      expect(shape).toHaveProperty('budgetId');
      expect(shape).not.toHaveProperty('categoryId');
    });

    it('CreateTransactionSchema inner shape should have budgetId, not categoryId', () => {
      // CreateTransactionSchema is a superRefine, so we need to check the inner shape
      const innerShape =
        (
          CreateTransactionSchema as unknown as {
            _def: { schema: { shape: Record<string, unknown> } };
          }
        )._def?.schema?.shape ??
        (CreateTransactionSchema as unknown as { shape: Record<string, unknown> }).shape;

      expect(innerShape).toHaveProperty('budgetId');
      expect(innerShape).not.toHaveProperty('categoryId');
    });

    it('ExpenseSchema should have budgetId field, not categoryId', () => {
      const shape = ExpenseSchema.shape;

      expect(shape).toHaveProperty('budgetId');
      expect(shape).not.toHaveProperty('categoryId');
    });

    it('IncomeSchema should have budgetId field, not categoryId', () => {
      const shape = IncomeSchema.shape;

      expect(shape).toHaveProperty('budgetId');
      expect(shape).not.toHaveProperty('categoryId');
    });

    it('BudgetGoalSchema should have budgetId field, not categoryId', () => {
      const shape = BudgetGoalSchema.shape;

      expect(shape).toHaveProperty('budgetId');
      expect(shape).not.toHaveProperty('categoryId');
    });

    it('ChildTransactionSchema should have budgetId field, not categoryId', () => {
      const shape = ChildTransactionSchema.shape;

      expect(shape).toHaveProperty('budgetId');
      expect(shape).not.toHaveProperty('categoryId');
    });

    it('AnticipationSchema should have budgetId field, not categoryId', () => {
      const shape = AnticipationSchemaImport.shape;

      expect(shape).toHaveProperty('budgetId');
      expect(shape).not.toHaveProperty('categoryId');
    });
  });
});
