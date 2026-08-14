-- ============================================================================
-- Migration: utility_providers
-- Promotes flat utility model (CustomUtilityType → UtilityReading with type
-- string, UtilityLink for expense binding) into structured hierarchy:
-- UtilityProvider → UtilityService → UtilityReading
-- ============================================================================

-- 1. Create enums
-- ---------------------------------------------------------------------------
CREATE TYPE "ServiceType" AS ENUM ('ELECTRIC', 'GAS', 'WATER', 'GARBAGE', 'SEWAGE', 'INTERNET', 'CELLULAR');
CREATE TYPE "Metering" AS ENUM ('METERED', 'UNMETERED');

-- 2. Create UtilityProvider table
-- ---------------------------------------------------------------------------
CREATE TABLE "UtilityProvider" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UtilityProvider_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UtilityProvider_name_key" ON "UtilityProvider"("name");

-- 3. Create UtilityService table
-- ---------------------------------------------------------------------------
CREATE TABLE "UtilityService" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "serviceType" "ServiceType" NOT NULL,
    "metering" "Metering" NOT NULL,
    "expenseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UtilityService_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UtilityService_providerId_idx" ON "UtilityService"("providerId");

ALTER TABLE "UtilityService" ADD CONSTRAINT "UtilityService_providerId_fkey"
    FOREIGN KEY ("providerId") REFERENCES "UtilityProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "UtilityService" ADD CONSTRAINT "UtilityService_expenseId_fkey"
    FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. Add nullable serviceId column to UtilityReading
-- ---------------------------------------------------------------------------
ALTER TABLE "UtilityReading" ADD COLUMN "serviceId" TEXT;

CREATE INDEX "UtilityReading_serviceId_idx" ON "UtilityReading"("serviceId");

ALTER TABLE "UtilityReading" ADD CONSTRAINT "UtilityReading_serviceId_fkey"
    FOREIGN KEY ("serviceId") REFERENCES "UtilityService"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- 5. DATA PROMOTION
-- ============================================================================

-- 5a. Insert one UtilityProvider per distinct CustomUtilityType name
-- ---------------------------------------------------------------------------
INSERT INTO "UtilityProvider" ("id", "name", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    "name",
    "createdAt",
    NOW()
FROM "CustomUtilityType";

-- 5b. Insert one UtilityService per provider, inferring ServiceType from name
--     using case-insensitive pattern matching. Default metering = METERED.
-- ---------------------------------------------------------------------------
INSERT INTO "UtilityService" ("id", "providerId", "serviceType", "metering", "expenseId", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    p."id",
    CASE
        WHEN LOWER(p."name") LIKE '%electric%' THEN 'ELECTRIC'::"ServiceType"
        WHEN LOWER(p."name") LIKE '%gas%'      THEN 'GAS'::"ServiceType"
        WHEN LOWER(p."name") LIKE '%water%'    THEN 'WATER'::"ServiceType"
        WHEN LOWER(p."name") LIKE '%garbage%'  THEN 'GARBAGE'::"ServiceType"
        WHEN LOWER(p."name") LIKE '%trash%'    THEN 'GARBAGE'::"ServiceType"
        WHEN LOWER(p."name") LIKE '%waste%'    THEN 'GARBAGE'::"ServiceType"
        WHEN LOWER(p."name") LIKE '%sewage%'   THEN 'SEWAGE'::"ServiceType"
        WHEN LOWER(p."name") LIKE '%sewer%'    THEN 'SEWAGE'::"ServiceType"
        WHEN LOWER(p."name") LIKE '%internet%' THEN 'INTERNET'::"ServiceType"
        WHEN LOWER(p."name") LIKE '%wifi%'     THEN 'INTERNET'::"ServiceType"
        WHEN LOWER(p."name") LIKE '%broadband%' THEN 'INTERNET'::"ServiceType"
        WHEN LOWER(p."name") LIKE '%cellular%' THEN 'CELLULAR'::"ServiceType"
        WHEN LOWER(p."name") LIKE '%cell%'     THEN 'CELLULAR'::"ServiceType"
        WHEN LOWER(p."name") LIKE '%mobile%'   THEN 'CELLULAR'::"ServiceType"
        WHEN LOWER(p."name") LIKE '%phone%'    THEN 'CELLULAR'::"ServiceType"
        ELSE 'ELECTRIC'::"ServiceType"
    END,
    'METERED'::"Metering",
    NULL,
    p."createdAt",
    NOW()
FROM "UtilityProvider" p;

-- 5c. Promote UtilityLink records: set expenseId on the corresponding UtilityService
--     Match via UtilityLink.type = UtilityProvider.name (the provider was created
--     from CustomUtilityType which shares the same name space as UtilityLink.type)
-- ---------------------------------------------------------------------------
UPDATE "UtilityService" s
SET "expenseId" = l."expenseId"
FROM "UtilityLink" l
JOIN "UtilityProvider" p ON LOWER(p."name") = LOWER(l."type")
WHERE s."providerId" = p."id";

-- 5d. Set serviceId on each UtilityReading to the service whose provider name
--     matches the reading's type string
-- ---------------------------------------------------------------------------
UPDATE "UtilityReading" r
SET "serviceId" = s."id"
FROM "UtilityService" s
JOIN "UtilityProvider" p ON p."id" = s."providerId"
WHERE LOWER(p."name") = LOWER(r."type");

-- ============================================================================
-- 6. CLEANUP — Drop legacy tables and columns
-- ============================================================================

-- 6a. Drop UtilityLink table (FK constraint first)
-- ---------------------------------------------------------------------------
ALTER TABLE "UtilityLink" DROP CONSTRAINT IF EXISTS "UtilityLink_expenseId_fkey";
DROP TABLE "UtilityLink";

-- 6b. Drop CustomUtilityType table
-- ---------------------------------------------------------------------------
DROP TABLE "CustomUtilityType";

-- 6c. Drop the legacy 'type' column from UtilityReading
-- ---------------------------------------------------------------------------
ALTER TABLE "UtilityReading" DROP COLUMN "type";

-- 6d. Drop the legacy 'expenseId' column from UtilityReading
--     (expense link now lives on UtilityService)
-- ---------------------------------------------------------------------------
ALTER TABLE "UtilityReading" DROP CONSTRAINT IF EXISTS "UtilityReading_expenseId_fkey";
ALTER TABLE "UtilityReading" DROP COLUMN "expenseId";

-- 6e. Make serviceId non-nullable on UtilityReading
-- ---------------------------------------------------------------------------
ALTER TABLE "UtilityReading" ALTER COLUMN "serviceId" SET NOT NULL;

-- 6f. Add unique constraint on (providerId, serviceType) in UtilityService
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "UtilityService_providerId_serviceType_key" ON "UtilityService"("providerId", "serviceType");

-- 6g. Add billDate index on UtilityReading (per design)
-- ---------------------------------------------------------------------------
CREATE INDEX "UtilityReading_billDate_idx" ON "UtilityReading"("billDate");
