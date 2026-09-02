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

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && !value.trim()) return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

function absentFinding(
  category: FindingCategory,
  sourceName: string,
  reliability: SourceReliability,
  label: string,
  provider: string,
): BureauFindingDraft {
  return {
    category,
    sourceName,
    reliability,
    confidence: 70,
    title: `Consultado — nada consta em ${label}`,
    summary: `${sourceName} foi consultado e não retornou registro para ${label}.`,
    details: {
      consultedAbsent: true,
      label,
      provider,
      status: 'CHECKED_ABSENT',
    } as Prisma.InputJsonValue,
    verified: true,
  };
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
  options?: { pillarLabel?: string; emitAbsences?: boolean },
): BureauFindingDraft[] {
  const findings: BureauFindingDraft[] = [];
  const seenCases = new Set<string>();
  const emitAbsences = options?.emitAbsences !== false;

  const ordered = [
    ...results.filter((r) => isBigDataCorpSlug(r.provider)),
    ...results.filter((r) => !isBigDataCorpSlug(r.provider)),
  ];

  let identityDone = false;
  let anyLawsuit = false;
  let anySanction = false;
  let anyPep = false;
  let anyProtest = false;
  let anyCollection = false;
  let anyFinancial = false;
  let pillarSource = options?.pillarLabel ?? 'Bureau';
  let pillarReliability: SourceReliability = 'THIRD_PARTY';

  for (const result of ordered) {
    const sourceName = providerDisplayName(result.provider);
    pillarSource = sourceName;
    const reliability: SourceReliability = isBigDataCorpSlug(result.provider)
      ? 'PAID'
      : 'THIRD_PARTY';
    pillarReliability = reliability;
    const sections = sectionsOf(result.payload);
    const cadastral = sections.cadastral ?? {};
    const pldft = sections.pldft ?? sections.sanctions ?? {};
    const litigation = sections.litigation ?? sections.litigationEsg ?? {};
    const financial = sections.financial ?? sections.fiscalHealth ?? {};
    const credit = sections.credit ?? {};

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
      anyPep = true;
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

    const sanctionHits = asList(pldft.sanctionsHits ?? pldft.internationalHits);
    if (pldft.isSanctioned === true || sanctionHits.length > 0) {
      anySanction = true;
      for (const hit of sanctionHits.slice(0, 12)) {
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
      anyLawsuit = true;
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

    const protests = asList(financial.protests);
    if (protests.length > 0) {
      anyProtest = true;
      for (const protest of protests.slice(0, 20)) {
        const item = asRecord(protest);
        findings.push({
          category: 'FINANCIAL',
          sourceName,
          reliability,
          confidence: 85,
          title: `Protesto ${readString(item.status, item.Status) ?? ''}`.trim(),
          summary: `Valor ${String(item.amount ?? item.valor ?? 'n/d')}`,
          details: { ...item, provider: result.provider } as Prisma.InputJsonValue,
          verified: false,
        });
      }
    }

    const totalAssets = readString(financial.totalAssets);
    const incomeRange = readString(
      financial.estimatedIncomeRange,
      asRecord(financial.incomeEstimates).BIGDATA_V2,
      asRecord(financial.incomeEstimates).BIGDATA,
      asRecord(financial.incomeEstimates).MTE,
    );
    if (totalAssets || incomeRange) {
      anyFinancial = true;
      findings.push({
        category: 'FINANCIAL',
        sourceName,
        reliability,
        confidence: 88,
        title: 'Patrimônio e renda estimada',
        summary: [
          totalAssets ? `Patrimônio estimado: ${totalAssets}` : null,
          incomeRange ? `Renda estimada: ${incomeRange}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
        details: {
          totalAssets: financial.totalAssets ?? null,
          estimatedIncomeRange: financial.estimatedIncomeRange ?? null,
          incomeEstimates: financial.incomeEstimates ?? null,
          provider: result.provider,
        } as Prisma.InputJsonValue,
        verified: false,
      });
    }

    const riskScore = financial.financialRiskScore;
    const riskLevel = readString(financial.financialRiskLevel);
    if (riskScore != null || riskLevel) {
      anyFinancial = true;
      findings.push({
        category: 'FINANCIAL',
        sourceName,
        reliability,
        confidence: 87,
        title: `Score de risco financeiro${riskLevel ? ` · faixa ${riskLevel}` : ''}`,
        summary:
          riskScore != null
            ? `Score ${String(riskScore)}${riskLevel ? ` (nível ${riskLevel})` : ''}`
            : `Nível ${riskLevel}`,
        details: {
          financialRiskScore: riskScore ?? null,
          financialRiskLevel: riskLevel,
          provider: result.provider,
        } as Prisma.InputJsonValue,
        verified: false,
      });
    }

    const collections = asRecord(financial.collections);
    const onCollection =
      financial.isCurrentlyOnCollection === true ||
      credit.collectionsPresence === true ||
      collections.IsCurrentlyOnCollection === true;
    if (onCollection || Object.keys(collections).length > 0) {
      if (onCollection) anyCollection = true;
      anyFinancial = true;
      const occurrences =
        collections.CollectionOccurrences ?? collections.Last365DaysCollectionOccurrences;
      findings.push({
        category: 'FINANCIAL',
        sourceName,
        reliability,
        confidence: 86,
        title: onCollection ? 'Em cobrança atualmente' : 'Histórico de cobrança (collections)',
        summary: onCollection
          ? 'Indicativo de presença atual em cobrança no bureau'
          : `Sem cobrança atual · ocorrências históricas: ${String(occurrences ?? 'n/d')}`,
        details: {
          collectionsPresence: onCollection,
          collections: Object.keys(collections).length ? collections : null,
          provider: result.provider,
        } as Prisma.InputJsonValue,
        verified: false,
      });
      if (!onCollection && Number(occurrences) > 0) anyCollection = true;
    } else if (credit.collectionsPresence === true) {
      anyCollection = true;
      anyFinancial = true;
      findings.push({
        category: 'FINANCIAL',
        sourceName,
        reliability,
        confidence: 84,
        title: 'Presença em cobrança',
        summary: 'Indicativo de collections no bureau',
        details: { collectionsPresence: true, provider: result.provider } as Prisma.InputJsonValue,
        verified: false,
      });
    }

    const taxReturns = asList(financial.taxReturns);
    if (taxReturns.length > 0) {
      anyFinancial = true;
      const withBank = taxReturns
        .map((row) => asRecord(row))
        .filter((row) => readString(row.Bank, row.bank))
        .slice(-5);
      const latest = asRecord(taxReturns[taxReturns.length - 1]);
      findings.push({
        category: 'FINANCIAL',
        sourceName,
        reliability,
        confidence: 82,
        title: 'Declarações / restituição IR (histórico)',
        summary: [
          latest.Year ? `Último ano mapeado: ${String(latest.Year)}` : null,
          readString(latest.Status, latest.status),
          withBank.length
            ? `Banco(s) em restituição: ${withBank
                .map((r) => [readString(r.Bank), readString(r.Branch)].filter(Boolean).join('/'))
                .join(', ')}`
            : 'Sem banco de restituição informado nos anos disponíveis',
        ]
          .filter(Boolean)
          .join(' · '),
        details: {
          taxReturns: taxReturns.slice(-8),
          banksFromTaxReturns: withBank,
          provider: result.provider,
        } as Prisma.InputJsonValue,
        verified: false,
      });
    }

    const occupations = asList(financial.occupations);
    if (occupations.length > 0) {
      anyFinancial = true;
      for (const job of occupations.slice(0, 8)) {
        const item = asRecord(job);
        const company = readString(item.CompanyName, item.companyName) ?? 'Empresa';
        const income =
          item.Income != null
            ? `Renda informada ~ ${String(item.Income)}`
            : readString(item.IncomeRange, item.incomeRange);
        findings.push({
          category: 'FINANCIAL',
          sourceName,
          reliability,
          confidence: 85,
          title: `Vínculo profissional: ${company}`,
          summary: [
            readString(item.Level, item.Status, item.status),
            readString(item.Sector, item.sector),
            income,
          ]
            .filter(Boolean)
            .join(' · '),
          details: { ...item, provider: result.provider } as Prisma.InputJsonValue,
          verified: false,
        });
      }
    }

    if (!isEmptyValue(financial.federalDebt) || !isEmptyValue(pldft.governmentDebtors)) {
      findings.push({
        category: 'FINANCIAL',
        sourceName,
        reliability,
        confidence: 86,
        title: 'Dívida / débito governamental',
        summary: 'Registro de débito mapeado pelo bureau',
        details: {
          federalDebt: financial.federalDebt ?? null,
          governmentDebtors: pldft.governmentDebtors ?? null,
          provider: result.provider,
        } as Prisma.InputJsonValue,
        verified: false,
      });
    }
  }

  if (emitAbsences && results.length > 0) {
    if (!identityDone) {
      findings.push(
        absentFinding(
          'IDENTITY',
          pillarSource,
          pillarReliability,
          'identidade cadastral',
          'pillar',
        ),
      );
    }
    if (!anyLawsuit) {
      findings.push(
        absentFinding('LAWSUIT', pillarSource, pillarReliability, 'processos judiciais', 'pillar'),
      );
    }
    if (!anySanction) {
      findings.push(
        absentFinding('SANCTION', pillarSource, pillarReliability, 'sanções', 'pillar'),
      );
    }
    if (!anyPep) {
      findings.push(
        absentFinding('ELECTORAL', pillarSource, pillarReliability, 'cadastro PEP', 'pillar'),
      );
    }
    if (!anyProtest) {
      findings.push(
        absentFinding('FINANCIAL', pillarSource, pillarReliability, 'protestos', 'pillar'),
      );
    }
    if (!anyCollection && !anyFinancial) {
      findings.push(
        absentFinding(
          'FINANCIAL',
          pillarSource,
          pillarReliability,
          'cobranças / collections',
          'pillar',
        ),
      );
    }
    // Serasa is not in the catalog; Boa Vista/Quod are marketplace and may be disabled.
    if (!options?.pillarLabel || options.pillarLabel === 'BigDataCorp') {
      findings.push({
        category: 'FINANCIAL',
        sourceName: pillarSource,
        reliability: pillarReliability,
        confidence: 60,
        title: 'Consultado — Serasa não disponível neste dossiê',
        summary:
          'Não há integração Serasa no catálogo. Crédito marketplace (Boa Vista/Quod) só entra quando o dataset estiver ativo no contrato BigDataCorp.',
        details: {
          consultedAbsent: true,
          label: 'Serasa / birô clássico',
          status: 'CHECKED_ABSENT',
          note: 'serasa_not_in_catalog',
        } as Prisma.InputJsonValue,
        verified: true,
      });
    }
  }

  return findings;
}
