-- CreateTable
CREATE TABLE "InsurancePolicy" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "employer" TEXT NOT NULL,
    "medicalPremium" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "dentalPremium" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "visionPremium" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "deductibleLimit" DECIMAL(65,30) NOT NULL,
    "oopmLimit" DECIMAL(65,30) NOT NULL,
    "frozen" BOOLEAN NOT NULL DEFAULT false,
    "frozenAt" TIMESTAMP(3),
    "deductibleOverride" BOOLEAN NOT NULL DEFAULT false,
    "oopmOverride" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InsurancePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyCategoryLink" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyCategoryLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PolicyCategoryLink_policyId_categoryId_key" ON "PolicyCategoryLink"("policyId", "categoryId");

-- AddForeignKey
ALTER TABLE "PolicyCategoryLink" ADD CONSTRAINT "PolicyCategoryLink_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "InsurancePolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex (partial unique: at most one active policy per year)
CREATE UNIQUE INDEX "one_active_policy_per_year" ON "InsurancePolicy" ("year") WHERE frozen = false;
