-- Rename tables: Category -> Budget, CategoryGroup -> BudgetGroup, PolicyCategoryLink -> PolicyBudgetLink
ALTER TABLE "Category" RENAME TO "Budget";
ALTER TABLE "CategoryGroup" RENAME TO "BudgetGroup";
ALTER TABLE "PolicyCategoryLink" RENAME TO "PolicyBudgetLink";

-- Rename FK columns across all referencing tables
ALTER TABLE "Expense" RENAME COLUMN "categoryId" TO "budgetId";
ALTER TABLE "Income" RENAME COLUMN "categoryId" TO "budgetId";
ALTER TABLE "Transaction" RENAME COLUMN "categoryId" TO "budgetId";
ALTER TABLE "BudgetGoal" RENAME COLUMN "categoryId" TO "budgetId";
ALTER TABLE "CategoryBudget" RENAME COLUMN "categoryId" TO "budgetId";
ALTER TABLE "PolicyBudgetLink" RENAME COLUMN "categoryId" TO "budgetId";

-- Rename primary key constraints for renamed tables
ALTER INDEX "Category_pkey" RENAME TO "Budget_pkey";
ALTER INDEX "CategoryGroup_pkey" RENAME TO "BudgetGroup_pkey";
ALTER INDEX "PolicyCategoryLink_pkey" RENAME TO "PolicyBudgetLink_pkey";

-- Rename unique indexes for renamed tables
ALTER INDEX "CategoryGroup_name_key" RENAME TO "BudgetGroup_name_key";
ALTER INDEX "PolicyCategoryLink_policyId_categoryId_key" RENAME TO "PolicyBudgetLink_policyId_budgetId_key";

-- Rename unique index on CategoryBudget (column renamed from categoryId to budgetId)
ALTER INDEX "CategoryBudget_yearPlanId_categoryId_key" RENAME TO "CategoryBudget_yearPlanId_budgetId_key";

-- Rename foreign key constraints for renamed tables and columns
ALTER TABLE "Budget" RENAME CONSTRAINT "Category_groupId_fkey" TO "Budget_groupId_fkey";
ALTER TABLE "Expense" RENAME CONSTRAINT "Expense_categoryId_fkey" TO "Expense_budgetId_fkey";
ALTER TABLE "Income" RENAME CONSTRAINT "Income_categoryId_fkey" TO "Income_budgetId_fkey";
ALTER TABLE "Transaction" RENAME CONSTRAINT "Transaction_categoryId_fkey" TO "Transaction_budgetId_fkey";
ALTER TABLE "BudgetGoal" RENAME CONSTRAINT "BudgetGoal_categoryId_fkey" TO "BudgetGoal_budgetId_fkey";
ALTER TABLE "CategoryBudget" RENAME CONSTRAINT "CategoryBudget_categoryId_fkey" TO "CategoryBudget_budgetId_fkey";
ALTER TABLE "PolicyBudgetLink" RENAME CONSTRAINT "PolicyCategoryLink_policyId_fkey" TO "PolicyBudgetLink_policyId_fkey";

-- Update stored string references in BudgetGroup names
UPDATE "BudgetGroup" SET name = REPLACE(name, 'Category', 'Budget') WHERE name LIKE '%Category%';
