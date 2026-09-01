import type { Prisma } from '@prisma/client';
import type {
  DossierLegalBasis,
  DossierPurpose,
  TargetType,
} from '../../contracts/enums/intel.enums.js';
import type {
  CreateIntelDossierInput,
  IntelDossierResponse,
} from '../../contracts/types/intel-dossier.types.js';
import { prisma } from '../../db/prisma.js';
import { assessDossierRisk, buildIntelBrief, resolvePurposeAndBasis } from '../../intel/brief.js';
import { classifyScore, scoreDossier } from '../../intel/scoring.js';
import { isValidTarget } from '../../providers/adapters/registry.js';
import { runIntelSearch } from './intel.orchestrator.js';
import { consultAllForDocument } from '../compliance/compliance.orchestrator.js';
import { findingsToSections, mergeIntelIntoComplianceDossier } from '../../dossier/intel-bridge.js';
import { buildDossier } from '../compliance/dossier.service.js';
import type { ComplianceDossier } from '../../contracts/types/compliance-dossier.types.js';
import { emptyPjSections } from '../../contracts/types/compliance-dossier.types.js';
import { ComplianceStatus } from '../../contracts/enums/compliance-status.enum.js';
import { RiskLevel } from '../../contracts/enums/risk-level.enum.js';

function mapDossier(row: {
  id: string;
  target: string;
  targetType: string;
  status: string;
  overallScore: number | null;
  purpose: string;
  legalBasis: string;
  deepSearch: boolean;
  partyName: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  findings: Array<{
    id: string;
    category: string;
    sourceName: string;
    reliability: string;
    confidence: number;
    title: string;
    summary: string;
    details: unknown;
    url: string | null;
    occurredAt: Date | null;
    verified: boolean;
  }>;
  sources: Array<{
    id: string;
    name: string;
    providerSlug: string | null;
    category: string;
    reliability: string;
    status: string;
    httpStatus: number | null;
    durationMs: number | null;
    error: string | null;
  }>;
}): IntelDossierResponse {
  const findings = row.findings.map((f) => ({
    id: f.id,
    category: f.category as IntelDossierResponse['findings'][0]['category'],
    sourceName: f.sourceName,
    reliability: f.reliability as IntelDossierResponse['findings'][0]['reliability'],
    confidence: f.confidence,
    title: f.title,
    summary: f.summary,
    details:
      f.details && typeof f.details === 'object' && !Array.isArray(f.details)
        ? (f.details as Record<string, unknown>)
        : {},
    url: f.url,
    occurredAt: f.occurredAt?.toISOString() ?? null,
    verified: f.verified,
  }));
  const sources = row.sources.map((s) => ({
    id: s.id,
    name: s.name,
    providerSlug: s.providerSlug,
    category: s.category as IntelDossierResponse['sources'][0]['category'],
    reliability: s.reliability as IntelDossierResponse['sources'][0]['reliability'],
    status: s.status,
    httpStatus: s.httpStatus,
    durationMs: s.durationMs,
    error: s.error,
  }));
  const score =
    row.overallScore ??
    scoreDossier(
      row.findings.map((f) => ({
        confidence: f.confidence,
        reliability: f.reliability as IntelDossierResponse['findings'][0]['reliability'],
        verified: f.verified,
        occurredAt: f.occurredAt,
      })),
    );
  const purpose = row.purpose as DossierPurpose;
  return {
    id: row.id,
    target: row.target,
    targetType: row.targetType as TargetType,
    status: row.status as IntelDossierResponse['status'],
    overallScore: score,
    scoreLabel: row.overallScore != null ? classifyScore(score) : null,
    purpose,
    legalBasis: row.legalBasis as DossierLegalBasis,
    deepSearch: row.deepSearch,
    partyName: row.partyName,
    findings,
    sources,
    riskBrief: assessDossierRisk(findings),
    intelBrief: buildIntelBrief({ purpose, score, findings, sources }),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

async function loadDossier(id: string) {
  return prisma.intelDossier.findUnique({
    where: { id },
    include: { findings: true, sources: true },
  });
}

export async function createIntelDossier(
  input: CreateIntelDossierInput,
): Promise<IntelDossierResponse> {
  const target = input.target.trim();
  if (!isValidTarget(input.targetType, target)) {
    throw new Error(`Alvo inválido para tipo ${input.targetType}`);
  }
  const { purpose, legalBasis } = resolvePurposeAndBasis({
    purpose: input.purpose,
    legalBasis: input.legalBasis,
  });

  const dossier = await prisma.intelDossier.create({
    data: {
      target,
      targetType: input.targetType,
      status: 'PENDING',
      purpose,
      legalBasis,
      deepSearch: input.deepSearch ?? false,
      partyName: input.partyName,
      tenantId: input.tenantId,
      requestedBy: input.requestedBy,
    },
  });

  await prisma.intelDossierAuditLog.create({
    data: {
      dossierId: dossier.id,
      action: `created:${purpose}`,
      actor: input.requestedBy,
    },
  });

  await runIntelSearch({
    dossierId: dossier.id,
    deepSearch: input.deepSearch ?? false,
    paidProviders: input.paidProviders,
    partyNameHint: input.partyName,
  });

  if (
    input.includeBureau !== false &&
    (input.targetType === 'CPF' || input.targetType === 'CNPJ')
  ) {
    await consultAllForDocument({
      document: target.replace(/\D/g, ''),
      documentType: input.targetType,
      requestedBy: input.requestedBy,
    });
  }

  const full = await loadDossier(dossier.id);
  if (!full) throw new Error('Dossiê intel não encontrado após criação');
  return mapDossier(full);
}

export async function getIntelDossier(id: string): Promise<IntelDossierResponse | null> {
  const row = await loadDossier(id);
  if (!row) return null;
  return mapDossier(row);
}

export async function listIntelDossiers(params: {
  target?: string;
  targetType?: TargetType;
  status?: string;
  skip?: number;
  take?: number;
}) {
  const where: Prisma.IntelDossierWhereInput = {};
  if (params.target) where.target = { contains: params.target };
  if (params.targetType) where.targetType = params.targetType;
  if (params.status) where.status = params.status as Prisma.EnumIntelDossierStatusFilter['equals'];

  const [items, total] = await Promise.all([
    prisma.intelDossier.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: params.skip ?? 0,
      take: Math.min(params.take ?? 20, 100),
      include: { findings: true, sources: true },
    }),
    prisma.intelDossier.count({ where }),
  ]);

  return { total, items: items.map(mapDossier) };
}

export async function regenerateIntelDossier(
  id: string,
  requestedBy?: string,
): Promise<IntelDossierResponse> {
  const existing = await prisma.intelDossier.findUnique({ where: { id } });
  if (!existing) throw new Error('Dossiê intel não encontrado');

  await prisma.intelDossierFinding.deleteMany({ where: { dossierId: id } });
  await prisma.intelDossierSource.deleteMany({ where: { dossierId: id } });
  await prisma.intelDossier.update({
    where: { id },
    data: { status: 'PENDING', overallScore: null, completedAt: null, error: null },
  });
  await prisma.intelDossierAuditLog.create({
    data: { dossierId: id, action: 'regenerated', actor: requestedBy },
  });

  await runIntelSearch({
    dossierId: id,
    deepSearch: existing.deepSearch,
    partyNameHint: existing.partyName ?? undefined,
  });

  const full = await loadDossier(id);
  if (!full) throw new Error('Dossiê intel não encontrado após regeneração');
  return mapDossier(full);
}

export async function getIntelCanonicalDossier(id: string): Promise<ComplianceDossier | null> {
  const intel = await getIntelDossier(id);
  if (!intel) return null;

  if (intel.targetType !== 'CPF' && intel.targetType !== 'CNPJ') {
    const intelSections = findingsToSections(intel.findings);
    const baseSections = emptyPjSections();
    const merged = mergeIntelIntoComplianceDossier(
      {
        meta: {
          document: intel.target,
          documentType: 'CNPJ',
          version: 1,
          generatedAt: new Date().toISOString(),
          completeness: 0.4,
          hash: `intel-${intel.id}`,
        },
        subject: { target: intel.target, targetType: intel.targetType },
        sections: baseSections,
        sources: intel.sources.map((s) => ({
          providerSlug: s.providerSlug ?? s.name,
          consultedAt: intel.createdAt,
          cacheHit: false,
        })),
        risk: {
          level: RiskLevel.medio,
          score: intel.overallScore ?? 50,
          factors: [],
          complianceStatus: ComplianceStatus.pendente,
          blocked: false,
          requiresManualReview: true,
          recommendation: intel.intelBrief.headline,
        },
        compliance: {
          status: ComplianceStatus.pendente,
          blocked: false,
          alerts: [],
        },
        audit: { requestedBy: null, reportHash: `intel-${intel.id}` },
      },
      intelSections,
    );
    return merged;
  }

  const document = intel.target.replace(/\D/g, '');
  const { dossier } = await buildDossier({
    document,
    documentType: intel.targetType,
    requestedBy: undefined,
  });
  const intelSections = findingsToSections(intel.findings);
  return mergeIntelIntoComplianceDossier(dossier as ComplianceDossier, intelSections);
}

export async function buildFullComplianceDossier(params: {
  document: string;
  documentType: 'CPF' | 'CNPJ';
  deepSearch?: boolean;
  requestedBy?: string;
}) {
  const intel = await createIntelDossier({
    target: params.document,
    targetType: params.documentType,
    deepSearch: params.deepSearch ?? false,
    requestedBy: params.requestedBy,
    includeBureau: true,
  });
  const canonical = await getIntelCanonicalDossier(intel.id);
  return { intel, canonical };
}
