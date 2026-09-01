import type { ComplianceStatus, DocumentType, Prisma, RiskLevel } from '@prisma/client';
import { ComplianceStatus as ContractComplianceStatus } from '../../contracts/enums/compliance-status.enum.js';
import { RiskLevel as ContractRiskLevel } from '../../contracts/enums/risk-level.enum.js';
import { prisma } from '../../db/prisma.js';
import { assembleDossier } from '../../dossier/dossier.assembler.js';
import { evaluateRisk } from '../../risk/risk.engine.js';
import { getBdcMaxTier } from '../../providers/provider.tiers.js';
import { consultAllForDocument } from './compliance.orchestrator.js';
import { getCachedConsultations, logAudit, toConsultationInput } from './compliance.service.js';

export async function buildDossier(params: {
  document: string;
  documentType: DocumentType;
  providerSlug?: string;
  requestedBy?: string;
  forceRefresh?: boolean;
  maxTier?: number;
}) {
  const maxTier = getBdcMaxTier(params.maxTier);

  await consultAllForDocument({
    document: params.document,
    documentType: params.documentType,
    providerSlug: params.providerSlug,
    requestedBy: params.requestedBy,
    maxTier,
  });

  const consultations = await getCachedConsultations(params.document, params.documentType);
  const consultationInputs = consultations.map((c) => toConsultationInput(c, true));

  const latestVersion = await prisma.complianceDossier.findFirst({
    where: { document: params.document, documentType: params.documentType },
    orderBy: { version: 'desc' },
  });

  const version = (latestVersion?.version ?? 0) + 1;

  const rules = await prisma.riskRule.findMany({ where: { isActive: true } });

  const tempDossier = assembleDossier({
    document: params.document,
    documentType: params.documentType,
    version,
    consultations: consultationInputs,
    risk: {
      level: ContractRiskLevel.baixo,
      score: 0,
      factors: [],
      complianceStatus: ContractComplianceStatus.pendente,
      blocked: false,
      requiresManualReview: false,
      recommendation: null,
    },
    requestedBy: params.requestedBy,
  });

  const risk = evaluateRisk(tempDossier, rules, params.documentType);
  const dossier = assembleDossier({
    document: params.document,
    documentType: params.documentType,
    version,
    consultations: consultationInputs,
    risk,
    requestedBy: params.requestedBy,
  });

  const saved = await prisma.complianceDossier.create({
    data: {
      document: params.document,
      documentType: params.documentType,
      version,
      payload: dossier as object,
      completeness: dossier.meta.completeness,
      hash: dossier.meta.hash,
      requestedBy: params.requestedBy,
      riskAssessment: {
        create: {
          level: risk.level as RiskLevel,
          score: risk.score,
          factors: risk.factors as unknown as Prisma.InputJsonValue,
          complianceStatus: risk.complianceStatus as ComplianceStatus,
          blocked: risk.blocked,
          requiresManualReview: risk.requiresManualReview,
          recommendation: risk.recommendation,
        },
      },
    },
    include: { riskAssessment: true },
  });

  dossier.meta.dossierId = saved.id;

  await logAudit({
    action: 'dossier_generated',
    document: params.document,
    metadata: { version, riskLevel: risk.level, maxTier, providerCount: consultationInputs.length },
  });

  return { dossier, assessment: saved.riskAssessment };
}

export async function getLatestDossier(document: string, documentType: DocumentType) {
  return prisma.complianceDossier.findFirst({
    where: { document, documentType },
    orderBy: { version: 'desc' },
    include: { riskAssessment: true },
  });
}
