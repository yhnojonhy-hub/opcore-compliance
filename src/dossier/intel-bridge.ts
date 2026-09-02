import type { DocumentType } from '@prisma/client';
import type { FindingCategory } from '../contracts/enums/intel.enums.js';
import type { ComplianceDossier } from '../contracts/types/compliance-dossier.types.js';
import type { IntelFinding } from '../contracts/types/intel-dossier.types.js';
import { normalizeLawsuitItem, normalizeLawsuitList } from './normalizers/lawsuit.normalizer.js';
import { normalizeProtestItem } from './normalizers/protest.normalizer.js';
import { normalizeSanctionFinding } from './normalizers/sanctions.normalizer.js';
import { OSINT_CANONICAL_MAP } from './osint-canonical-map.js';
import { asRecord, readString } from './normalizers/read.util.js';

function appendToSectionArray(
  sections: Record<string, Record<string, unknown>>,
  sectionKey: string,
  fieldKey: string,
  value: unknown,
): void {
  const section = sections[sectionKey] ?? {};
  const current = section[fieldKey];
  if (Array.isArray(current)) {
    section[fieldKey] = [...current, value];
  } else if (current === undefined || current === null) {
    section[fieldKey] = [value];
  } else {
    section[fieldKey] = [current, value];
  }
  sections[sectionKey] = section;
}

function findingToCanonicalValue(
  finding: IntelFinding,
  target: { section: string; field: string },
): unknown {
  const details = finding.details ?? {};

  if (target.field === 'lawsuits') {
    return normalizeLawsuitItem(
      {
        ...details,
        court: details.court ?? details.tribunal ?? details.alias,
        type: details.type ?? details.classe ?? finding.title,
        status: details.status ?? finding.summary,
        numeroProcesso: details.numeroProcesso ?? details.processNumber,
        dataAjuizamento: details.dataAjuizamento ?? finding.occurredAt,
        source: finding.sourceName,
      },
      finding.sourceName,
    );
  }

  if (target.field === 'sanctionsHits' || target.field === 'internationalHits') {
    return normalizeSanctionFinding(
      {
        ...details,
        title: finding.title,
        caption: finding.title,
        name: finding.title,
      },
      finding.sourceName,
    );
  }

  if (target.field === 'protests') {
    return normalizeProtestItem({
      ...details,
      amount: details.amount ?? details.valor,
      status: details.status ?? 'ativo',
      date: details.date ?? details.data ?? finding.occurredAt,
    });
  }

  if (target.field === 'restrictiveListHits' || target.field === 'ceisRecords') {
    return {
      list: finding.sourceName,
      reason: finding.summary,
      status: finding.verified ? 'confirmado' : 'referência',
      details,
    };
  }

  if (target.section === 'cadastral') {
    const name = readString(details.razao_social, details.nome, details.name, finding.title);
    if (name && (target.field === 'fullName' || target.field === 'legalName' || !target.field)) {
      return name;
    }
  }

  return {
    source: finding.sourceName,
    category: finding.category,
    title: finding.title,
    summary: finding.summary,
    confidence: finding.confidence,
    verified: finding.verified,
    url: finding.url,
    details,
    occurredAt: finding.occurredAt,
  };
}

function applyCadastralScalar(
  sections: Record<string, Record<string, unknown>>,
  finding: IntelFinding,
  documentType: DocumentType | null,
): void {
  if (finding.category !== 'IDENTITY' && finding.category !== 'ADDRESS') return;
  const details = finding.details ?? {};
  const cadastral = sections.cadastral ?? {};

  const name = readString(details.razao_social, details.nome, details.name, finding.title);
  if (name) {
    if (documentType === 'CPF' && !cadastral.fullName) cadastral.fullName = name;
    if (documentType === 'CNPJ' && !cadastral.legalName) cadastral.legalName = name;
  }

  const tradeName = readString(details.nome_fantasia, details.tradeName);
  if (tradeName && documentType === 'CNPJ' && !cadastral.tradeName) {
    cadastral.tradeName = tradeName;
  }

  const status = readString(
    details.descricao_situacao_cadastral,
    details.situacao,
    details.situacao_cadastral,
  );
  if (status) {
    if (documentType === 'CPF' && !cadastral.cpfStatus) cadastral.cpfStatus = status.toUpperCase();
    if (documentType === 'CNPJ' && !cadastral.cnpjStatus)
      cadastral.cnpjStatus = status.toUpperCase();
  }

  sections.cadastral = cadastral;
}

export function findingsToSections(
  findings: IntelFinding[],
  documentType: DocumentType | null = null,
): Record<string, Record<string, unknown>> {
  const sections: Record<string, Record<string, unknown>> = {};

  for (const finding of findings) {
    applyCadastralScalar(sections, finding, documentType);

    const targets = OSINT_CANONICAL_MAP[finding.category as FindingCategory]?.(documentType) ?? [];
    for (const target of targets) {
      if (
        target.field === 'identityRecords' ||
        target.field === 'addresses' ||
        target.field === 'domains'
      ) {
        continue;
      }

      const value = findingToCanonicalValue(finding, target);

      if (
        target.field === 'lawsuits' ||
        target.field === 'sanctionsHits' ||
        target.field === 'internationalHits' ||
        target.field === 'protests' ||
        target.field === 'restrictiveListHits' ||
        target.field === 'ceisRecords'
      ) {
        appendToSectionArray(sections, target.section, target.field, value);
        continue;
      }

      const section = sections[target.section] ?? {};
      if (section[target.field] === undefined || section[target.field] === null) {
        section[target.field] = value;
      }
      sections[target.section] = section;
    }
  }

  for (const [sectionKey, sectionValue] of Object.entries(sections)) {
    if (Array.isArray(sectionValue.lawsuits)) {
      sectionValue.lawsuits = normalizeLawsuitList(sectionValue.lawsuits);
    }
    sections[sectionKey] = sectionValue;
  }

  return sections;
}

export function mergeIntelIntoComplianceDossier(
  compliance: ComplianceDossier,
  intelSections: Record<string, Record<string, unknown>>,
): ComplianceDossier {
  const merged = structuredClone(compliance);
  const targetSections = merged.sections as unknown as Record<string, Record<string, unknown>>;

  for (const [sectionKey, intelData] of Object.entries(intelSections)) {
    const existing = targetSections[sectionKey] ?? {};
    for (const [field, value] of Object.entries(intelData)) {
      if (Array.isArray(value) && Array.isArray(existing[field])) {
        existing[field] = [...(existing[field] as unknown[]), ...value];
      } else if (existing[field] === undefined || existing[field] === null) {
        existing[field] = value;
      } else if (
        typeof value === 'string' &&
        (existing[field] === null || existing[field] === undefined || existing[field] === '')
      ) {
        existing[field] = value;
      }
    }
    targetSections[sectionKey] = existing;
  }

  merged.sections = targetSections as unknown as ComplianceDossier['sections'];
  return merged;
}
