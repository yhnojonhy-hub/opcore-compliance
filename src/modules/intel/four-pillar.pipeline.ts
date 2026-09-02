import type { TargetType } from '../../contracts/enums/intel.enums.js';
import type { ConsultResult } from '../compliance/compliance.service.js';
import { consultAllForDocument } from '../compliance/compliance.orchestrator.js';
import { runIntelSearch } from './intel.orchestrator.js';
import {
  bureauConsultationsToFindings,
  extractPartyNameFromConsultations,
  type BureauFindingDraft,
} from '../../dossier/bureau-findings.js';
import { isBigDataCorpSlug } from '../../dossier/section-merge.js';
import { prisma } from '../../db/prisma.js';
import type { Prisma } from '@prisma/client';

export type PillarId = 'bdc' | 'lemit' | 'brasilapi' | 'extras';

export interface PillarStatus {
  id: PillarId;
  label: string;
  status: 'ok' | 'partial' | 'error' | 'skipped';
  providerCount: number;
  findingCount: number;
  error?: string;
}

export interface FourPillarSummary {
  bdc: PillarStatus;
  lemit: PillarStatus;
  brasilapi: PillarStatus;
  extras: PillarStatus;
}

function emptyPillar(id: PillarId, label: string): PillarStatus {
  return { id, label, status: 'skipped', providerCount: 0, findingCount: 0 };
}

async function persistPillarFindings(params: {
  dossierId: string;
  pillarName: string;
  results: ConsultResult[];
  documentType: 'CPF' | 'CNPJ';
  emitAbsences: boolean;
}): Promise<{ partyName?: string; findingCount: number }> {
  const partyName = extractPartyNameFromConsultations(params.results, params.documentType);
  if (partyName) {
    await prisma.intelDossier.update({
      where: { id: params.dossierId },
      data: { partyName },
    });
  }

  const drafts = bureauConsultationsToFindings(params.results, params.documentType, {
    pillarLabel: params.pillarName,
    emitAbsences: params.emitAbsences,
  });

  const byProvider = new Map<string, ConsultResult>();
  for (const result of params.results) {
    if (!byProvider.has(result.provider)) byProvider.set(result.provider, result);
  }

  for (const result of byProvider.values()) {
    await prisma.intelDossierSource.create({
      data: {
        dossierId: params.dossierId,
        name: params.pillarName,
        providerSlug: result.provider,
        category: 'IDENTITY',
        reliability: isBigDataCorpSlug(result.provider) ? 'PAID' : 'THIRD_PARTY',
        status: 'ok',
        durationMs: null,
        error: null,
      },
    });
  }

  if (params.results.length === 0) {
    await prisma.intelDossierSource.create({
      data: {
        dossierId: params.dossierId,
        name: params.pillarName,
        providerSlug: null,
        category: 'IDENTITY',
        reliability: 'THIRD_PARTY',
        status: 'error',
        error: 'Nenhum provedor respondeu neste pilar',
      },
    });
  }

  if (drafts.length > 0) {
    await prisma.intelDossierFinding.createMany({
      data: drafts.map((finding: BureauFindingDraft) => ({
        dossierId: params.dossierId,
        category: finding.category,
        sourceName: finding.sourceName,
        reliability: finding.reliability,
        confidence: finding.confidence,
        title: finding.title,
        summary: finding.summary,
        details: finding.details,
        url: finding.url,
        occurredAt: finding.occurredAt,
        verified: finding.verified,
      })),
    });
  }

  return { partyName, findingCount: drafts.length };
}

/**
 * Runs the four dossier pillars in order: BDC → Lemit → BrasilAPI → Extras (OSINT).
 * Report assembly happens only after all four complete.
 */
export async function runFourPillarPipeline(params: {
  dossierId: string;
  target: string;
  targetType: TargetType;
  requestedBy?: string;
  forceRefresh?: boolean;
  deepSearch?: boolean;
  paidProviders?: string[];
  includeBureau?: boolean;
  existingPartyName?: string | null;
}): Promise<{ partyName?: string; pillars: FourPillarSummary; bureauResults: ConsultResult[] }> {
  const pillars: FourPillarSummary = {
    bdc: emptyPillar('bdc', 'BigDataCorp'),
    lemit: emptyPillar('lemit', 'Lemit'),
    brasilapi: emptyPillar('brasilapi', 'Brasil API'),
    extras: emptyPillar('extras', 'Extras / OSINT'),
  };

  let partyName = params.existingPartyName ?? undefined;
  const bureauResults: ConsultResult[] = [];
  const isDoc = params.targetType === 'CPF' || params.targetType === 'CNPJ';
  const document = params.target.replace(/\D/g, '');
  const includeBureau = params.includeBureau !== false && isDoc;

  if (includeBureau) {
    // 1) BDC full catalog
    try {
      const bdcResults = await consultAllForDocument({
        document,
        documentType: params.targetType as 'CPF' | 'CNPJ',
        slugPrefixes: ['bigdatacorp'],
        requestedBy: params.requestedBy,
        forceRefresh: params.forceRefresh,
        softFail: true,
        skipBdcPartition: true,
        // Full catalog (tiers 1–3); env BDC_MAX_TIER may still be 1 on older deploys.
        maxTier: 3,
      });
      bureauResults.push(...bdcResults);
      const persisted = await persistPillarFindings({
        dossierId: params.dossierId,
        pillarName: 'BigDataCorp',
        results: bdcResults,
        documentType: params.targetType as 'CPF' | 'CNPJ',
        emitAbsences: true,
      });
      if (persisted.partyName) partyName = persisted.partyName;
      pillars.bdc = {
        id: 'bdc',
        label: 'BigDataCorp',
        status: bdcResults.length > 0 ? 'ok' : 'error',
        providerCount: bdcResults.length,
        findingCount: persisted.findingCount,
        error: bdcResults.length === 0 ? 'Sem resposta BDC' : undefined,
      };
    } catch (error) {
      pillars.bdc = {
        id: 'bdc',
        label: 'BigDataCorp',
        status: 'error',
        providerCount: 0,
        findingCount: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    // 2) Lemit
    const lemitSlug = params.targetType === 'CPF' ? 'lemit-cpf' : 'lemit-cnpj';
    try {
      const lemitResults = await consultAllForDocument({
        document,
        documentType: params.targetType as 'CPF' | 'CNPJ',
        providerSlug: lemitSlug,
        requestedBy: params.requestedBy,
        forceRefresh: params.forceRefresh,
        softFail: true,
      });
      bureauResults.push(...lemitResults);
      const persisted = await persistPillarFindings({
        dossierId: params.dossierId,
        pillarName: 'Lemit',
        results: lemitResults,
        documentType: params.targetType as 'CPF' | 'CNPJ',
        emitAbsences: true,
      });
      if (persisted.partyName && !partyName) partyName = persisted.partyName;
      pillars.lemit = {
        id: 'lemit',
        label: 'Lemit',
        status: lemitResults.length > 0 ? 'ok' : 'error',
        providerCount: lemitResults.length,
        findingCount: persisted.findingCount,
        error: lemitResults.length === 0 ? 'Sem resposta Lemit' : undefined,
      };
    } catch (error) {
      pillars.lemit = {
        id: 'lemit',
        label: 'Lemit',
        status: 'error',
        providerCount: 0,
        findingCount: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    // 3) BrasilAPI
    const brasilSlug = params.targetType === 'CPF' ? 'brasilapi-cpf' : 'brasilapi-cnpj';
    try {
      const brasilResults = await consultAllForDocument({
        document,
        documentType: params.targetType as 'CPF' | 'CNPJ',
        providerSlug: brasilSlug,
        requestedBy: params.requestedBy,
        forceRefresh: params.forceRefresh,
        softFail: true,
      });
      bureauResults.push(...brasilResults);
      const persisted = await persistPillarFindings({
        dossierId: params.dossierId,
        pillarName: 'Brasil API',
        results: brasilResults,
        documentType: params.targetType as 'CPF' | 'CNPJ',
        emitAbsences: true,
      });
      if (persisted.partyName && !partyName) partyName = persisted.partyName;
      pillars.brasilapi = {
        id: 'brasilapi',
        label: 'Brasil API',
        status: brasilResults.length > 0 ? 'ok' : 'error',
        providerCount: brasilResults.length,
        findingCount: persisted.findingCount,
        error: brasilResults.length === 0 ? 'Sem resposta Brasil API' : undefined,
      };
    } catch (error) {
      pillars.brasilapi = {
        id: 'brasilapi',
        label: 'Brasil API',
        status: 'error',
        providerCount: 0,
        findingCount: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  } else {
    pillars.bdc.status = 'skipped';
    pillars.lemit.status = 'skipped';
    pillars.brasilapi.status = 'skipped';
  }

  // 4) Extras / OSINT
  const beforeSources = await prisma.intelDossierSource.count({
    where: { dossierId: params.dossierId },
  });
  const beforeFindings = await prisma.intelDossierFinding.count({
    where: { dossierId: params.dossierId },
  });

  try {
    await runIntelSearch({
      dossierId: params.dossierId,
      deepSearch: params.deepSearch ?? false,
      paidProviders: params.paidProviders,
      partyNameHint: partyName,
    });
    const afterSources = await prisma.intelDossierSource.count({
      where: { dossierId: params.dossierId },
    });
    const afterFindings = await prisma.intelDossierFinding.count({
      where: { dossierId: params.dossierId },
    });
    pillars.extras = {
      id: 'extras',
      label: 'Extras / OSINT',
      status: 'ok',
      providerCount: Math.max(0, afterSources - beforeSources),
      findingCount: Math.max(0, afterFindings - beforeFindings),
    };
  } catch (error) {
    pillars.extras = {
      id: 'extras',
      label: 'Extras / OSINT',
      status: 'error',
      providerCount: 0,
      findingCount: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  await prisma.intelDossierAuditLog.create({
    data: {
      dossierId: params.dossierId,
      action: 'four_pillars_completed',
      actor: params.requestedBy,
      metadata: pillars as unknown as Prisma.InputJsonValue,
    },
  });

  return { partyName, pillars, bureauResults };
}

export function derivePillarsFromSources(
  sources: Array<{ name: string; status: string }>,
  findings: Array<{ sourceName: string }>,
): FourPillarSummary {
  const count = (names: string[]) =>
    sources.filter((s) => names.some((n) => s.name.toLowerCase().includes(n.toLowerCase())));
  const findingCount = (names: string[]) =>
    findings.filter((f) => names.some((n) => f.sourceName.toLowerCase().includes(n.toLowerCase())))
      .length;

  const statusOf = (matched: Array<{ status: string }>): PillarStatus['status'] => {
    if (matched.length === 0) return 'skipped';
    if (matched.every((s) => s.status === 'ok')) return 'ok';
    if (matched.some((s) => s.status === 'ok')) return 'partial';
    return 'error';
  };

  const bdc = count(['BigDataCorp']);
  const lemit = count(['Lemit']);
  const brasil = count(['Brasil API', 'BrasilAPI']);
  const known = new Set([...bdc, ...lemit, ...brasil]);
  const extras = sources.filter((s) => !known.has(s));

  return {
    bdc: {
      id: 'bdc',
      label: 'BigDataCorp',
      status: statusOf(bdc),
      providerCount: bdc.length,
      findingCount: findingCount(['BigDataCorp']),
    },
    lemit: {
      id: 'lemit',
      label: 'Lemit',
      status: statusOf(lemit),
      providerCount: lemit.length,
      findingCount: findingCount(['Lemit']),
    },
    brasilapi: {
      id: 'brasilapi',
      label: 'Brasil API',
      status: statusOf(brasil),
      providerCount: brasil.length,
      findingCount: findingCount(['Brasil']),
    },
    extras: {
      id: 'extras',
      label: 'Extras / OSINT',
      status: statusOf(extras),
      providerCount: extras.length,
      findingCount: Math.max(
        0,
        findings.length -
          findingCount(['BigDataCorp']) -
          findingCount(['Lemit']) -
          findingCount(['Brasil']),
      ),
    },
  };
}
