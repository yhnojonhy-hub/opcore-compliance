import type { DossierLegalBasis } from '../contracts/enums/intel.enums.js';

export const DOSSIER_PURPOSES = ['KYC', 'PRE_CONTRACT', 'MA', 'LITIGATION', 'CREDIT'] as const;
export type DossierPurpose = (typeof DOSSIER_PURPOSES)[number];
export type RiskLevel = 'GREEN' | 'YELLOW' | 'RED';

export const PURPOSE_LABEL: Record<DossierPurpose, string> = {
  KYC: 'KYC / due diligence',
  PRE_CONTRACT: 'Pré-contratação',
  MA: 'M&A / aquisição',
  LITIGATION: 'Litígio / defesa',
  CREDIT: 'Proteção ao crédito',
};

export const PURPOSE_TO_LEGAL_BASIS: Record<DossierPurpose, DossierLegalBasis> = {
  KYC: 'LEGITIMATE_INTEREST',
  PRE_CONTRACT: 'CONTRACT',
  MA: 'LEGITIMATE_INTEREST',
  LITIGATION: 'LEGAL_RIGHTS',
  CREDIT: 'CREDIT_PROTECTION',
};

const LEGAL_BASIS_TO_PURPOSE: Record<DossierLegalBasis, DossierPurpose> = {
  LEGITIMATE_INTEREST: 'KYC',
  CONTRACT: 'PRE_CONTRACT',
  LEGAL_RIGHTS: 'LITIGATION',
  CREDIT_PROTECTION: 'CREDIT',
};

export const CATEGORY_LABEL: Record<string, string> = {
  IDENTITY: 'Identidade',
  ADDRESS: 'Endereço',
  SANCTION: 'Sanções',
  LAWSUIT: 'Processos',
  MANDADO: 'Mandados',
  INTIMACAO: 'Intimações',
  FINANCIAL: 'Financeiro',
  SOCIAL_PRESENCE: 'Redes sociais',
  NEWS: 'Notícias',
  BREACH: 'Vazamentos',
  DOMAIN: 'Domínio',
  ELECTORAL: 'Eleitoral',
  REPUTATION: 'Reputação',
  TRAVEL_DOC: 'Passaporte / Interpol',
};

const RISK_CATEGORIES = [
  'SANCTION',
  'LAWSUIT',
  'MANDADO',
  'INTIMACAO',
  'REPUTATION',
  'FINANCIAL',
  'NEWS',
  'TRAVEL_DOC',
  'BREACH',
  'ELECTORAL',
] as const;

const NEGATIVE_RE =
  /nenhum|não encontr|nao encontr|não consta|nao consta|sem registro|sem sanção|sem sanco|sem processo|não há |nao ha |lista vazia|sem ocorrência|sem ocorrencia|não aplicável|nao aplicavel|sem hit|sem alerta/;

const ADVERSE_RE =
  /sanção|sancao|inidôneo|inidoneo|inabilit|ceis|cnep|cepim|ceaf|ofac|conden|irregular|réu|reu\b|mandado|wanted|red notice|lenién|lenien|contas irregulares|inabilitad|pep\b|politicamente expost/;

export interface CategoryRisk {
  category: string;
  label: string;
  level: RiskLevel;
  count: number;
  hits: number;
}

export interface DossierRiskBrief {
  overall: RiskLevel;
  categories: CategoryRisk[];
}

export type GapKind = 'unchecked' | 'failed';

export interface DossierGap {
  kind: GapKind;
  source: string;
  citation: string;
  reason: string;
}

export interface DossierIntelBrief {
  headline: string;
  estimative: string;
  confidence: 'alta' | 'media' | 'baixa';
  judgements: string[];
  checkedAbsent: string[];
  gaps: DossierGap[];
}

const ESTIMATIVE: Record<RiskLevel, string> = {
  GREEN: 'improvável',
  YELLOW: 'chance aproximada',
  RED: 'provável',
};

const UNCHECKED_RE =
  /captcha|csv|xml|não está ligada|nao esta ligada|desativado|não configurada|nao configurada|carga |imprensa nacional|stub|ainda não/;

export function isDossierPurpose(value: string): value is DossierPurpose {
  return (DOSSIER_PURPOSES as readonly string[]).includes(value);
}

export function parsePurpose(action?: string | null): DossierPurpose {
  const raw = action?.startsWith('created:') ? action.slice('created:'.length) : undefined;
  if (raw && isDossierPurpose(raw)) return raw;
  return 'KYC';
}

export function purposeOf(
  action: string | null | undefined,
  legalBasis?: DossierLegalBasis | string | null,
): DossierPurpose {
  if (action?.startsWith('created:')) return parsePurpose(action);
  return purposeFromLegalBasis(legalBasis);
}

export function purposeFromLegalBasis(basis?: DossierLegalBasis | string | null): DossierPurpose {
  if (basis && basis in LEGAL_BASIS_TO_PURPOSE) {
    return LEGAL_BASIS_TO_PURPOSE[basis as DossierLegalBasis];
  }
  return 'KYC';
}

export function resolvePurposeAndBasis(input: {
  purpose?: string;
  legalBasis?: DossierLegalBasis;
}): { purpose: DossierPurpose; legalBasis: DossierLegalBasis } {
  const purpose =
    input.purpose && isDossierPurpose(input.purpose)
      ? input.purpose
      : purposeFromLegalBasis(input.legalBasis);
  return {
    purpose,
    legalBasis: input.legalBasis ?? PURPOSE_TO_LEGAL_BASIS[purpose],
  };
}

export function sourceCite(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function isNegativeFinding(text: string): boolean {
  return NEGATIVE_RE.test(text.toLowerCase());
}

export function isAdverseFinding(text: string): boolean {
  const lower = text.toLowerCase();
  if (isNegativeFinding(lower)) return false;
  return ADVERSE_RE.test(lower);
}

function worse(a: RiskLevel, b: RiskLevel): RiskLevel {
  const rank = { GREEN: 0, YELLOW: 1, RED: 2 };
  return rank[a] >= rank[b] ? a : b;
}

function assessCategory(
  category: string,
  items: Array<{ title: string; summary: string }>,
): RiskLevel {
  if (items.length === 0) return 'GREEN';
  const texts = items.map((item) => `${item.title} ${item.summary}`);
  const hits = texts.filter((text) => !isNegativeFinding(text));
  const adverse = texts.filter(isAdverseFinding);

  if (category === 'SANCTION' || category === 'MANDADO' || category === 'TRAVEL_DOC') {
    return adverse.length > 0 ? 'RED' : 'GREEN';
  }
  if (category === 'LAWSUIT' || category === 'INTIMACAO') {
    if (adverse.length >= 3 || hits.length >= 5) return 'RED';
    if (hits.length > 0) return 'YELLOW';
    return 'GREEN';
  }
  if (category === 'NEWS' || category === 'REPUTATION' || category === 'FINANCIAL') {
    if (adverse.length > 0) return 'YELLOW';
    if (hits.length > 0) return 'YELLOW';
    return 'GREEN';
  }
  if (category === 'BREACH' || category === 'ELECTORAL') {
    return hits.length > 0 ? 'YELLOW' : 'GREEN';
  }
  return hits.length > 0 ? 'YELLOW' : 'GREEN';
}

export function assessDossierRisk(
  findings: Array<{ category: string; title: string; summary: string }>,
): DossierRiskBrief {
  const categories = RISK_CATEGORIES.map((category) => {
    const items = findings.filter((finding) => finding.category === category);
    const hits = items.filter((item) => !isNegativeFinding(`${item.title} ${item.summary}`)).length;
    return {
      category,
      label: CATEGORY_LABEL[category] ?? category,
      level: assessCategory(category, items),
      count: items.length,
      hits,
    };
  });
  const overall = categories.reduce<RiskLevel>(
    (current, item) => worse(current, item.level),
    'GREEN',
  );
  return { overall, categories };
}

function confidenceLabel(
  score: number,
  sources: Array<{ status: string; reliability?: string }>,
): DossierIntelBrief['confidence'] {
  const officialOk = sources.filter(
    (source) => source.status === 'ok' && source.reliability === 'OFFICIAL',
  ).length;
  if (score >= 80 && officialOk >= 3) return 'alta';
  if (score >= 50 && officialOk >= 1) return 'media';
  return 'baixa';
}

export function collectGaps(
  sources: Array<{ name: string; status: string; error?: string | null }>,
): DossierGap[] {
  const gaps: DossierGap[] = [];
  for (const source of sources) {
    const reason = source.error?.trim() || '';
    if (source.status === 'error') {
      gaps.push({
        kind: 'failed',
        source: source.name,
        citation: sourceCite(source.name),
        reason: reason || 'A fonte falhou no momento da consulta',
      });
      continue;
    }
    if (source.status === 'rate_limited') {
      gaps.push({
        kind: 'unchecked',
        source: source.name,
        citation: sourceCite(source.name),
        reason: 'Limite da fonte atingido; não foi possível concluir a consulta',
      });
      continue;
    }
    if (source.status === 'skipped' && UNCHECKED_RE.test(reason.toLowerCase())) {
      gaps.push({
        kind: 'unchecked',
        source: source.name,
        citation: sourceCite(source.name),
        reason,
      });
    }
  }
  return gaps;
}

export function buildIntelBrief(input: {
  purpose: DossierPurpose;
  score: number;
  findings: Array<{ category: string; title: string; summary: string }>;
  sources: Array<{ name: string; status: string; error?: string | null; reliability?: string }>;
}): DossierIntelBrief {
  const risk = assessDossierRisk(input.findings);
  const reds = risk.categories.filter((item) => item.level === 'RED').map((item) => item.label);
  const yellows = risk.categories
    .filter((item) => item.level === 'YELLOW')
    .map((item) => item.label);
  const checkedAbsent = risk.categories
    .filter((item) => item.level === 'GREEN' && item.count > 0)
    .map((item) => item.label);
  const gaps = collectGaps(input.sources);
  const estimative = ESTIMATIVE[risk.overall];
  const confidence = confidenceLabel(input.score, input.sources);

  let headline: string;
  if (risk.overall === 'RED') {
    headline = `Leitura: é ${estimative} haver problema em ${reds.join(', ').toLowerCase()}. Finalidade: ${PURPOSE_LABEL[input.purpose]}. Abra essas abas primeiro.`;
  } else if (risk.overall === 'YELLOW') {
    headline = `Leitura: há ${estimative} de atenção em ${yellows.join(', ').toLowerCase()}. Não apareceu sanção, mandado nem lista internacional.`;
  } else {
    headline = `Leitura: é ${estimative} haver alerta grave nas fontes públicas desta busca (${PURPOSE_LABEL[input.purpose]}). O que está verde foi consultado e veio limpo.`;
  }

  const judgements = [
    risk.overall === 'GREEN'
      ? 'Fato: CEIS, CNEP, TCU, OFAC e as demais listas oficiais desta consulta não devolveram o alvo.'
      : `Fato: o semáforo ficou ${risk.overall === 'RED' ? 'vermelho' : 'amarelo'} por achado da fonte, não por palpite.`,
    gaps.length
      ? `Ainda não vimos: ${gaps.map((item) => item.source).join(', ')}. Ausência nessas bases não foi comprovada.`
      : 'As bases que faltam (BNMP, DOU, TSE) não se aplicam ou já estavam fora desta busca.',
    `Quão firme é isso: confiança ${confidence} (${input.score}/100), com ${input.sources.filter((item) => item.status === 'ok').length} fontes que responderam. Isso mede a consulta, não o risco da pessoa.`,
  ];

  return { headline, estimative, confidence, judgements, checkedAbsent, gaps };
}
