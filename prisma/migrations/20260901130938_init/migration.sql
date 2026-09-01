-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('CPF', 'CNPJ');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('baixo', 'medio', 'alto', 'muito_alto');

-- CreateEnum
CREATE TYPE "ComplianceStatus" AS ENUM ('aprovado', 'pendente', 'rejeitado', 'revisao_manual');

-- CreateTable
CREATE TABLE "Provider" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "httpMethod" TEXT NOT NULL,
    "requestTemplate" JSONB NOT NULL,
    "authType" TEXT NOT NULL,
    "authConfigRef" TEXT,
    "fieldMappings" JSONB NOT NULL,
    "supportedTypes" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Provider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceConsultation" (
    "id" TEXT NOT NULL,
    "document" TEXT NOT NULL,
    "documentType" "DocumentType" NOT NULL,
    "providerId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "rawPayload" JSONB NOT NULL,
    "requestedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "ComplianceConsultation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceDossier" (
    "id" TEXT NOT NULL,
    "document" TEXT NOT NULL,
    "documentType" "DocumentType" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "completeness" DOUBLE PRECISION NOT NULL,
    "hash" TEXT NOT NULL,
    "requestedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceDossier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskAssessment" (
    "id" TEXT NOT NULL,
    "dossierId" TEXT NOT NULL,
    "level" "RiskLevel" NOT NULL,
    "score" INTEGER NOT NULL,
    "factors" JSONB NOT NULL,
    "complianceStatus" "ComplianceStatus" NOT NULL,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "requiresManualReview" BOOLEAN NOT NULL DEFAULT false,
    "recommendation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskRule" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "documentTypes" TEXT[],
    "condition" JSONB NOT NULL,
    "weight" INTEGER NOT NULL,
    "severity" TEXT NOT NULL,
    "hardStop" BOOLEAN NOT NULL DEFAULT false,
    "minRiskLevel" "RiskLevel",
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "document" TEXT NOT NULL,
    "providerId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Provider_slug_key" ON "Provider"("slug");

-- CreateIndex
CREATE INDEX "ComplianceConsultation_document_idx" ON "ComplianceConsultation"("document");

-- CreateIndex
CREATE INDEX "ComplianceConsultation_createdAt_idx" ON "ComplianceConsultation"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceConsultation_document_documentType_providerId_key" ON "ComplianceConsultation"("document", "documentType", "providerId");

-- CreateIndex
CREATE INDEX "ComplianceDossier_document_idx" ON "ComplianceDossier"("document");

-- CreateIndex
CREATE INDEX "ComplianceDossier_createdAt_idx" ON "ComplianceDossier"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceDossier_document_documentType_version_key" ON "ComplianceDossier"("document", "documentType", "version");

-- CreateIndex
CREATE UNIQUE INDEX "RiskAssessment_dossierId_key" ON "RiskAssessment"("dossierId");

-- CreateIndex
CREATE UNIQUE INDEX "RiskRule_code_key" ON "RiskRule"("code");

-- CreateIndex
CREATE INDEX "AuditLog_document_idx" ON "AuditLog"("document");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "ComplianceConsultation" ADD CONSTRAINT "ComplianceConsultation_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskAssessment" ADD CONSTRAINT "RiskAssessment_dossierId_fkey" FOREIGN KEY ("dossierId") REFERENCES "ComplianceDossier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE SET NULL ON UPDATE CASCADE;
