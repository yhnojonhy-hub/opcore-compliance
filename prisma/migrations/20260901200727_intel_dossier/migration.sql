-- CreateEnum
CREATE TYPE "TargetType" AS ENUM ('CPF', 'CNPJ', 'PHONE', 'EMAIL', 'NAME', 'PASSAPORTE');

-- CreateEnum
CREATE TYPE "FindingCategory" AS ENUM ('IDENTITY', 'ADDRESS', 'SANCTION', 'LAWSUIT', 'MANDADO', 'INTIMACAO', 'FINANCIAL', 'SOCIAL_PRESENCE', 'NEWS', 'BREACH', 'DOMAIN', 'ELECTORAL', 'REPUTATION', 'TRAVEL_DOC');

-- CreateEnum
CREATE TYPE "SourceReliability" AS ENUM ('OFFICIAL', 'COMMUNITY', 'THIRD_PARTY', 'SCRAPING', 'PAID');

-- CreateEnum
CREATE TYPE "IntelDossierStatus" AS ENUM ('PENDING', 'PARTIAL', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "DossierPurpose" AS ENUM ('KYC', 'PRE_CONTRACT', 'MA', 'LITIGATION', 'CREDIT');

-- CreateEnum
CREATE TYPE "DossierLegalBasis" AS ENUM ('CONTRACT', 'LEGAL_RIGHTS', 'LEGITIMATE_INTEREST', 'CREDIT_PROTECTION');

-- CreateTable
CREATE TABLE "IntelDossier" (
    "id" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "targetType" "TargetType" NOT NULL,
    "status" "IntelDossierStatus" NOT NULL DEFAULT 'PENDING',
    "overallScore" INTEGER,
    "purpose" "DossierPurpose" NOT NULL DEFAULT 'KYC',
    "legalBasis" "DossierLegalBasis" NOT NULL DEFAULT 'LEGITIMATE_INTEREST',
    "deepSearch" BOOLEAN NOT NULL DEFAULT false,
    "partyName" TEXT,
    "tenantId" TEXT,
    "error" TEXT,
    "requestedBy" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntelDossier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntelDossierSource" (
    "id" TEXT NOT NULL,
    "dossierId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "providerSlug" TEXT,
    "category" "FindingCategory" NOT NULL,
    "reliability" "SourceReliability" NOT NULL,
    "status" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "durationMs" INTEGER,
    "error" TEXT,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntelDossierSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntelDossierFinding" (
    "id" TEXT NOT NULL,
    "dossierId" TEXT NOT NULL,
    "category" "FindingCategory" NOT NULL,
    "sourceName" TEXT NOT NULL,
    "reliability" "SourceReliability" NOT NULL,
    "confidence" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "url" TEXT,
    "occurredAt" TIMESTAMP(3),
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntelDossierFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntelDossierAuditLog" (
    "id" TEXT NOT NULL,
    "dossierId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntelDossierAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntelDossier_target_idx" ON "IntelDossier"("target");

-- CreateIndex
CREATE INDEX "IntelDossier_targetType_idx" ON "IntelDossier"("targetType");

-- CreateIndex
CREATE INDEX "IntelDossier_status_idx" ON "IntelDossier"("status");

-- CreateIndex
CREATE INDEX "IntelDossier_createdAt_idx" ON "IntelDossier"("createdAt");

-- CreateIndex
CREATE INDEX "IntelDossierSource_dossierId_idx" ON "IntelDossierSource"("dossierId");

-- CreateIndex
CREATE INDEX "IntelDossierFinding_dossierId_idx" ON "IntelDossierFinding"("dossierId");

-- CreateIndex
CREATE INDEX "IntelDossierFinding_category_idx" ON "IntelDossierFinding"("category");

-- CreateIndex
CREATE INDEX "IntelDossierAuditLog_dossierId_idx" ON "IntelDossierAuditLog"("dossierId");

-- CreateIndex
CREATE INDEX "IntelDossierAuditLog_createdAt_idx" ON "IntelDossierAuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "IntelDossierSource" ADD CONSTRAINT "IntelDossierSource_dossierId_fkey" FOREIGN KEY ("dossierId") REFERENCES "IntelDossier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntelDossierFinding" ADD CONSTRAINT "IntelDossierFinding_dossierId_fkey" FOREIGN KEY ("dossierId") REFERENCES "IntelDossier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntelDossierAuditLog" ADD CONSTRAINT "IntelDossierAuditLog_dossierId_fkey" FOREIGN KEY ("dossierId") REFERENCES "IntelDossier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
