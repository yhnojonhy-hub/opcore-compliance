import { isValidCnpj } from '../../../contracts/utils/document.util.js';
import { asRecord, fetchJson } from '../http.util.js';
import type { DossierProvider, ProviderContext, ProviderFinding } from '../types.js';

function skipped(reason: string) {
  return { status: 'skipped' as const, error: reason, findings: [] };
}

function ok(findings: ProviderFinding[], rawPayload?: unknown, httpStatus = 200) {
  return { status: 'ok' as const, httpStatus, rawPayload, findings };
}

function yyyymmdd(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function lastYearRange(): { dataInicial: string; dataFinal: string } {
  const end = new Date();
  const start = new Date(end.getTime() - 365 * 24 * 60 * 60 * 1000);
  return { dataInicial: yyyymmdd(start), dataFinal: yyyymmdd(end) };
}

function cnpjOf(ctx: ProviderContext): string | null {
  if (ctx.targetType !== 'CNPJ') return null;
  const value = ctx.target.replace(/[./\s-]/g, '').toUpperCase();
  return isValidCnpj(value) ? value : null;
}

function searchTerms(ctx: ProviderContext): string[] {
  const values = [
    cnpjOf(ctx),
    ctx.partyName,
    ctx.targetType === 'NAME' ? ctx.target : '',
    ...(ctx.aliases ?? []),
  ]
    .map((item) => item?.trim() ?? '')
    .filter((item) => item.length > 3);
  return [...new Set(values)].slice(0, 4);
}

export function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (Array.isArray(record.items)) return record.items;
  if (Array.isArray(record.data)) return record.data;
  if (Array.isArray(record.content)) return record.content;
  if (Array.isArray(record.resultados)) return record.resultados;
  if (Array.isArray(record.contratos)) return record.contratos;
  const hits = asRecord(record.hits);
  if (Array.isArray(hits.hits)) return hits.hits;
  return [];
}

function pick(item: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = item[key];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function contractUrl(item: Record<string, unknown>): string {
  const explicit = pick(item, ['url', 'link', 'uri', 'item_url']);
  if (explicit.startsWith('http')) return explicit;
  const control = pick(item, ['numeroControlePNCP', 'numero_controle_pncp']);
  const match = control.match(/^(\d{14})-(\d{4})-(\d+)/);
  if (match) {
    return `https://pncp.gov.br/app/contratos/${match[1]}/${match[2]}/${match[3]}`;
  }
  return 'https://pncp.gov.br/app/contratos';
}

export function toPncpFinding(row: unknown): ProviderFinding | null {
  const source = asRecord(row);
  const nested = asRecord(source._source);
  const item = Object.keys(nested).length ? { ...source, ...nested } : source;
  const title =
    pick(item, [
      'objetoContrato',
      'objeto',
      'title',
      'titulo',
      'nomeRazaoSocialFornecedor',
      'razaoSocialFornecedor',
      'description',
    ]) || 'Contrato PNCP';
  const orgao = pick(item, ['nomeOrgao', 'orgaoEntidade', 'orgao', 'nome_orgao']);
  const fornecedor = pick(item, [
    'nomeRazaoSocialFornecedor',
    'razaoSocialFornecedor',
    'nomeFornecedor',
  ]);
  const valor = pick(item, ['valorGlobal', 'valorTotal', 'valor', 'valor_global']);
  const vigencia = pick(item, ['dataVigenciaInicio', 'dataVigenciaFim', 'dataAssinatura', 'data']);
  const parts = [
    orgao && `Órgão ${orgao}`,
    fornecedor && `Fornecedor ${fornecedor}`,
    valor && `Valor ${valor}`,
    vigencia && `Vigência ${vigencia}`,
  ].filter(Boolean);
  return {
    category: 'FINANCIAL',
    title: title.slice(0, 180),
    summary: parts.join(' · ') || 'Contrato ou contratação indexada no PNCP',
    details: item,
    confidence: 82,
    url: contractUrl(item),
  };
}

export const pncp: DossierProvider = {
  name: 'PNCP',
  category: 'FINANCIAL',
  reliability: 'OFFICIAL',
  accepts: ['CNPJ', 'NAME'],
  phase: 'async',
  rateMs: 900,
  async run(ctx) {
    const terms = searchTerms(ctx);
    if (terms.length === 0) return skipped('PNCP precisa de CNPJ ou nome');

    const raw: unknown[] = [];
    const findings: ProviderFinding[] = [];
    const seen = new Set<string>();

    const pushRows = (rows: unknown[]) => {
      for (const row of rows.slice(0, 12)) {
        const finding = toPncpFinding(row);
        if (!finding) continue;
        const key = `${finding.title}|${finding.url ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push(finding);
      }
    };

    for (const term of terms) {
      const search = await fetchJson(
        `https://pncp.gov.br/api/search/?q=${encodeURIComponent(term)}&tipos_documento=contrato&ordenacao=-data&pagina=1&tam_pagina=10`,
        { headers: { Accept: 'application/json' } },
        12_000,
      );
      raw.push({ via: 'search', term, status: search.status });
      if (search.status === 429) return { status: 'rate_limited', httpStatus: 429, findings: [] };
      if (search.ok) pushRows(asList(search.json));
    }

    const cnpj = cnpjOf(ctx);
    if (cnpj) {
      const range = lastYearRange();
      const consulta = await fetchJson(
        `https://pncp.gov.br/api/consulta/v1/contratos?dataInicial=${range.dataInicial}&dataFinal=${range.dataFinal}&pagina=1&cnpjOrgao=${cnpj}`,
        { headers: { Accept: 'application/json' } },
        12_000,
      );
      raw.push({ via: 'consulta-orgao', status: consulta.status });
      if (consulta.status === 429) return { status: 'rate_limited', httpStatus: 429, findings: [] };
      if (consulta.ok) pushRows(asList(consulta.json));
    }

    const reached = raw.some((row) => Number(asRecord(row).status) > 0);
    if (!reached) return skipped('PNCP não respondeu a tempo');

    if (findings.length === 0) {
      return ok(
        [
          {
            category: 'FINANCIAL',
            title: 'Nenhum contrato PNCP no recorte',
            summary:
              'Busca pública e consulta de órgão (12 meses) sem contratos para este identificador',
            details: { terms },
            confidence: 62,
            url: 'https://pncp.gov.br/app/contratos',
          },
        ],
        raw,
      );
    }

    return ok(findings.slice(0, 12), raw);
  },
};
