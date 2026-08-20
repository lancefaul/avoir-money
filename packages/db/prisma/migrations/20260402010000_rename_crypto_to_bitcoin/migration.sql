-- Rename CRYPTO to BITCOIN and remove unused enum values
-- First update any existing rows
UPDATE "InvestmentHolding" SET type = 'STOCK' WHERE type IN ('ETF', 'MUTUAL_FUND', 'OTHER');

-- Rename CRYPTO -> BITCOIN
ALTER TYPE "InvestmentType" RENAME VALUE 'CRYPTO' TO 'BITCOIN';

-- Remove unused values (PostgreSQL doesn't support DROP VALUE directly,
-- so we recreate the enum with only the values we want)
-- Since we already migrated data above, we can safely do this:
CREATE TYPE "InvestmentType_new" AS ENUM ('STOCK', 'BITCOIN');
ALTER TABLE "InvestmentHolding" ALTER COLUMN type TYPE "InvestmentType_new" USING type::text::"InvestmentType_new";
DROP TYPE "InvestmentType";
ALTER TYPE "InvestmentType_new" RENAME TO "InvestmentType";
