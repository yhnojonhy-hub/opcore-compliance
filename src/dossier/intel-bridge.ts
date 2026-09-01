import type { FindingCategory } from '../contracts/enums/intel.enums.js';
import type { ComplianceDossier } from '../contracts/types/compliance-dossier.types.js';
import { emptyPjSections } from '../contracts/types/compliance-dossier.types.js';
import type { IntelFinding } from '../contracts/types/intel-dossier.types.js';

const CATEGORY_SECTION_MAP: Record<FindingCategory, string[]> = {
  IDENTITY: ['cadastral'],
  ADDRESS: ['cadastral'],
  SANCTION: ['sanctions', 'pldft'],
  LAWSUIT: ['litigation', 'litigationEsg'],
  MANDADO: ['litigation'],
  INTIMACAO: ['litigation'],
  FINANCIAL: ['financial', 'fiscalHealth', 'credit'],
  SOCIAL_PRESENCE: ['corporateLinks'],
  NEWS: ['litigationEsg'],
  BREACH: ['pldft'],
  DOMAIN: ['cadastral'],
  ELECTORAL: ['sanctions'],
  REPUTATION: ['litigationEsg'],
  TRAVEL_DOC: ['pldft', 'sanctions'],
};

export function findingToSectionRecord(finding: IntelFinding): Record<string, unknown> {
  return {
    source: finding.sourceName,
    category: finding.category,
    title: finding.title,
    summary: finding.summary,
    confidence: finding.confidence,
    verified: finding.verified,
    url: finding.url,
    details: finding.details,
    occurredAt: finding.occurredAt,
  };
}

export function findingsToSections(
  findings: IntelFinding[],
): Record<string, Record<string, unknown>> {
  const sections: Record<string, Record<string, unknown>> = {};
  for (const finding of findings) {
    const paths = CATEGORY_SECTION_MAP[finding.category] ?? ['cadastral'];
    const record = findingToSectionRecord(finding);
    for (const path of paths) {
      const bucket = sections[path] ?? {};
      const key = `${finding.category.toLowerCase()}Findings`;
      const list = Array.isArray(bucket[key]) ? (bucket[key] as unknown[]) : [];
      list.push(record);
      bucket[key] = list;
      sections[path] = bucket;
    }
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
      }
    }
    targetSections[sectionKey] = existing;
  }
  merged.sections = targetSections as ComplianceDossier['sections'];
  return merged;
}

export function consultationsToIntelFindings(
  consultations: Array<{ providerSlug: string; payload: Record<string, unknown> }>,
): IntelFinding[] {
  const findings: IntelFinding[] = [];
  for (const consultation of consultations) {
    const alerts = consultation.payload.alerts;
    if (Array.isArray(alerts)) {
      for (const alert of alerts) {
        if (!alert || typeof alert !== 'object') continue;
        const obj = alert as Record<string, unknown>;
        findings.push({
          id: `bureau-${consultation.providerSlug}-${String(obj.type ?? 'alert')}`,
          category: 'SANCTION',
          sourceName: consultation.providerSlug,
          reliability: 'PAID',
          confidence: 85,
          title: String(obj.type ?? 'Alerta bureau'),
          summary: String(obj.message ?? obj.description ?? 'Achado bureau'),
          details: obj,
          verified: false,
        });
      }
    }
  }
  return findings;
}
