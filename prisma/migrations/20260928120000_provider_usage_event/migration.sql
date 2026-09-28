-- CreateEnum
CREATE TYPE "BillingVendor" AS ENUM ('bigdatacorp', 'lemit', 'apollo');

-- CreateTable
CREATE TABLE "ProviderUsageEvent" (
    "id" TEXT NOT NULL,
    "vendor" "BillingVendor" NOT NULL,
    "providerSlug" TEXT NOT NULL,
    "dataset" TEXT,
    "credits" DECIMAL(12,4),
    "unitCostBrl" DECIMAL(12,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderUsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProviderUsageEvent_vendor_createdAt_idx" ON "ProviderUsageEvent"("vendor", "createdAt");
