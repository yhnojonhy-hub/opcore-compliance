import type { Prisma } from '@prisma/client';
import type { FindingCategory, SourceReliability } from '../contracts/enums/intel.enums.js';
import { asList } from '../contracts/utils/array.util.js';
import { flatMappedToSections } from '../contracts/utils/mapped-payload.util.js';
import { normalizeLawsuitList } from './normalizers/lawsuit.normalizer.js';
import { asRecord, readString } from './normalizers/read.util.js';
import { isBigDataCorpSlug } from './section-merge.js';

export interface BureauFindingDraft {
  category: FindingCategory;
  sourceName: string;
  reliability: SourceReliability;
  confidence: number;
  title: string;
  summary: string;
  details: Prisma.InputJsonValue;
  url?: string;
  occurredAt?: Date;
  verified: boolean;
}

function providerDisplayName(slug: string): string {
  if (isBigDataCorpSlug(slug)) return 'BigDataCorp';
  if (slug.startsWith('lemit')) return 'Lemit';
  if (slug.startsWith('brasilapi')) return 'Brasil API';
  return slug;
}

function sectionsOf(payload: { sections?: Record<string, Record<string, unknown>> } | unknown) {
  if (payload && typeof payload === 'object' && 'sections' in payload) {
    const sections = (payload as { sections?: Record<string, Record<string, unknown>> }).sections;
    if (sections) return sections;
  }
  if (payload && typeof payload === 'object') {
    return flatMappedToSections(payload as Record<string, unknown>);
  }
  return {};
}

/** Prefer BigDataCorp name; fall back to complementary bureaus. */
export function extractPartyNameFromConsultations(
  results: Array<{
    provider: string;
    payload: { sections: Record<string, Record<string, unknown>> };
  }>,
  documentType: 'CPF' | 'CNPJ',
): string | undefined {
  const ordered = [
    ...results.filter((r) => isBigDataCorpSlug(r.provider)),
    ...results.filter((r) => !isBigDataCorpSlug(r.provider)),
  ];
  for (const result of ordered) {
    const cadastral = sectionsOf(result.payload).cadastral ?? {};
    const name =
      documentType === 'CPF'
        ? readString(cadastral.fullName)
        : readString(cadastral.legalName, cadastral.tradeName);
    if (name && name.length > 2) return name;
  }
  return undefined;
}

export function bureauConsultationsToFindings(
  results: Array<{
    provider: string;
    payload: { sections: Record<string, Record<string, unknown>> };
  }>,
  documentType: 'CPF' | 'CNPJ',
): BureauFindingDraft[] {
  const findings: BureauFindingDraft[] = [];
  const seenCases = new Set<string>();

  const ordered = [
    ...results.filter((r) => isBigDataCorpSlug(r.provider)),
    ...results.filter((r) => !isBigDataCorpSlug(r.provider)),
  ];

  let identityDone = false;

  for (const result of ordered) {
    const sourceName = providerDisplayName(result.provider);
    const reliability: SourceReliability = isBigDataCorpSlug(result.provider)
      ? 'PAID'
      : 'THIRD_PARTY';
    const sections = sectionsOf(result.payload);
    const cadastral = sections.cadastral ?? {};
    const pldft = sections.pldft ?? sections.sanctions ?? {};
    const litigation = sections.litigation ?? sections.litigationEsg ?? {};

    if (!identityDone) {
      const name =
        documentType === 'CPF'
          ? readString(cadastral.fullName)
          : readString(cadastral.legalName, cadastral.tradeName);
      if (name) {
        const status = readString(cadastral.cpfStatus, cadastral.cnpjStatus, cadastral.status);
        findings.push({
          category: 'IDENTITY',
          sourceName,
          reliability,
          confidence: isBigDataCorpSlug(result.provider) ? 96 : 82,
          title: name,
          summary: status
            ? `Situação cadastral: ${status}`
            : `Identidade resolvida via ${sourceName}`,
          details: {
            nome: name,
            fullName: cadastral.fullName ?? null,
            legalName: cadastral.legalName ?? null,
            cpfStatus: cadastral.cpfStatus ?? null,
            cnpjStatus: cadastral.cnpjStatus ?? null,
            birthDate: cadastral.birthDate ?? null,
            motherName: cadastral.motherName ?? null,
            provider: result.provider,
          } as Prisma.InputJsonValue,
          verified: true,
        });
        identityDone = true;
      }
    }

    if (pldft.isPep === true) {
      findings.push({
        category: 'ELECTORAL',
        sourceName,
        reliability,
        confidence: 90,
        title: `PEP: ${readString(cadastral.fullName, cadastral.legalName) ?? 'documento'}`,
        summary: 'Indicativo de pessoa politicamente exposta no bureau',
        details: { isPep: true, provider: result.provider } as Prisma.InputJsonValue,
        verified: false,
      });
    }

    if (pldft.isSanctioned === true || asList(pldft.sanctionsHits).length > 0) {
      for (const hit of asList(pldft.sanctionsHits).slice(0, 12)) {
        const item = asRecord(hit);
        const title =
          readString(item.Source, item.source, item.name, item.caption) || 'Sanção bureau';
        findings.push({
          category: 'SANCTION',
          sourceName,
          reliability,
          confidence: 88,
          title,
          summary:
            readString(item.Type, item.type, item.StandardizedSanctionType) ||
            'Histórico de sanção no bureau',
          details: { ...item, provider: result.provider } as Prisma.InputJsonValue,
          verified: false,
        });
      }
    }

    const lawsuits = normalizeLawsuitList(litigation.lawsuits, sourceName);
    for (const lawsuit of lawsuits.slice(0, 40)) {
      const caseKey = (lawsuit.caseNumber ?? '').replace(/\D/g, '') || lawsuit.caseNumber || '';
      if (caseKey && seenCases.has(caseKey)) continue;
      if (caseKey) seenCases.add(caseKey);
      findings.push({
        category: 'LAWSUIT',
        sourceName,
        reliability,
        confidence: isBigDataCorpSlug(result.provider) ? 92 : 80,
        title: lawsuit.caseNumber || lawsuit.type || 'Processo',
        summary: [lawsuit.court, lawsuit.type, lawsuit.status].filter(Boolean).join(' · '),
        details: { ...lawsuit, provider: result.provider } as Prisma.InputJsonValue,
        occurredAt: lawsuit.filedAt ? new Date(lawsuit.filedAt) : undefined,
        verified: false,
      });
    }
  }

  return findings;
}
