import { createHash } from 'node:crypto';
import type { DocumentType } from '@prisma/client';
import {
  type ComplianceDossier,
  emptyPfSections,
  emptyPjSections,
  type PfSections,
  type PjSections,
} from '../contracts/types/compliance-dossier.types.js';
import type { RiskAssessmentResult } from '../contracts/types/compliance-dossier.types.js';
import { applyFieldMappings, mergeMappedIntoSections } from '../providers/provider.mapper.js';
import type { FieldMapping } from '../providers/provider.interface.js';

interface ConsultationInput {
  providerSlug: string;
  consultedAt: Date;
  cacheHit: boolean;
  payload: Record<string, unknown>;
  rawPayload: unknown;
  fieldMappings: FieldMapping[];
}

export function computeCompleteness(
  sections: PfSections | PjSections,
  documentType: DocumentType,
): number {
  const blocks = Object.values(sections);
  const filled = blocks.filter((block) =>
    Object.values(block).some((v) => v !== null && v !== undefined && v !== ''),
  ).length;
  const total = documentType === 'CPF' ? 6 : 5;
  return Math.round((filled / total) * 100) / 100;
}

export function hashDossier(
  dossier: Omit<ComplianceDossier, 'meta'> & {
    meta: Omit<ComplianceDossier['meta'], 'hash' | 'dossierId'>;
  },
): string {
  const payload = JSON.stringify(dossier);
  return `sha256:${createHash('sha256').update(payload).digest('hex')}`;
}

export function assembleDossier(params: {
  document: string;
  documentType: DocumentType;
  version: number;
  consultations: ConsultationInput[];
  risk: RiskAssessmentResult;
  requestedBy?: string | null;
  dossierId?: string;
}): ComplianceDossier {
  const sections: PfSections | PjSections =
    params.documentType === 'CPF' ? emptyPfSections() : emptyPjSections();

  for (const c of params.consultations) {
    const mapped = applyFieldMappings(c.rawPayload, c.fieldMappings);
    mergeMappedIntoSections(mapped, sections as unknown as Record<string, Record<string, unknown>>);
    if (Object.keys(mapped).length === 0 && c.payload) {
      mergeMappedIntoSections(
        c.payload,
        sections as unknown as Record<string, Record<string, unknown>>,
      );
    }
  }

  const completeness = computeCompleteness(sections, params.documentType);

  const subject =
    params.documentType === 'CPF'
      ? {
          type: 'PF',
          fullName: (sections as PfSections).cadastral.fullName ?? null,
        }
      : {
          type: 'PJ',
          legalName: (sections as PjSections).cadastral.legalName ?? null,
          tradeName: (sections as PjSections).cadastral.tradeName ?? null,
        };

  const alerts = params.risk.factors.map((f) => ({
    type: f.code.toLowerCase(),
    severity: f.severity,
  }));

  const baseMeta = {
    document: params.document,
    documentType: params.documentType,
    version: params.version,
    generatedAt: new Date().toISOString(),
    completeness,
    hash: '',
  };

  const dossierWithoutHash: ComplianceDossier = {
    meta: { ...baseMeta, hash: '', dossierId: params.dossierId },
    subject,
    risk: params.risk,
    compliance: {
      status: params.risk.complianceStatus,
      blocked: params.risk.blocked,
      alerts,
    },
    sections,
    sources: params.consultations.map((c) => ({
      providerSlug: c.providerSlug,
      consultedAt: c.consultedAt.toISOString(),
      cacheHit: c.cacheHit,
    })),
    audit: {
      requestedBy: params.requestedBy ?? null,
      reportHash: '',
    },
  };

  const hash = hashDossier(dossierWithoutHash);
  dossierWithoutHash.meta.hash = hash;
  dossierWithoutHash.audit.reportHash = hash;

  return dossierWithoutHash;
}
