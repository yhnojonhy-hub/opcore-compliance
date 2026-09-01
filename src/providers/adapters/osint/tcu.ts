import { digitsOnly, isValidCnpj, isValidCpf } from '../../../contracts/utils/document.util.js';
import { asRecord, fetchJson } from '../http.util.js';
import type { DossierProvider, ProviderContext, ProviderFinding } from '../types.js';

const BASE = 'https://certidoes.apps.tcu.gov.br/api/publico';

function skipped(reason: string) {
  return { status: 'skipped' as const, error: reason, findings: [] };
}

function ok(findings: ProviderFinding[], rawPayload?: unknown, httpStatus = 200) {
  return { status: 'ok' as const, httpStatus, rawPayload, findings };
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function namesOf(ctx: ProviderContext): string[] {
  const values = [
    ctx.partyName,
    ctx.targetType === 'NAME' ? ctx.target : '',
    ...(ctx.aliases ?? []),
  ]
    .map((item) => item?.trim() ?? '')
    .filter((item) => item.length > 3 && /[A-Za-zÀ-ÿ]/.test(item));
  return [...new Set(values)].slice(0, 2);
}

function filterBody(ctx: ProviderContext): Record<string, string> | null {
  if (ctx.targetType === 'CNPJ') {
    const cnpj = ctx.target.replace(/[./\s-]/g, '').toUpperCase();
    if (!isValidCnpj(cnpj)) return null;
    return { cnpj };
  }
  if (ctx.targetType === 'CPF') {
    const cpf = digitsOnly(ctx.target);
    if (!isValidCpf(cpf)) return null;
    return { cpf };
  }
  const name = namesOf(ctx)[0];
  if (!name) return null;
  return { parteNome: name };
}

const LISTS = [
  { path: 'responsaveis-inidoneos', label: 'Licitante inidôneo' },
  { path: 'responsaveis-inabilitados', label: 'Inabilitado para função pública' },
  { path: 'responsaveis-contas-irregulares', label: 'Contas irregulares' },
  { path: 'responsaveis-fins-eleitorais', label: 'Contas irregulares (efeito eleitoral)' },
] as const;

export const tcuSancoes: DossierProvider = {
  name: 'TCU sanções',
  category: 'SANCTION',
  reliability: 'OFFICIAL',
  accepts: ['CPF', 'CNPJ', 'NAME'],
  phase: 'async',
  rateMs: 400,
  async run(ctx) {
    const body = filterBody(ctx);
    if (!body) return skipped('TCU precisa de CPF, CNPJ ou nome');

    const raw: unknown[] = [];
    const findings: ProviderFinding[] = [];
    let reached = false;

    for (const list of LISTS) {
      if (
        list.path !== 'responsaveis-inidoneos' &&
        list.path !== 'responsaveis-contas-irregulares'
      ) {
        if (body.cnpj && !body.cpf && !body.parteNome) continue;
      }
      const result = await fetchJson(
        `${BASE}/${list.path}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body),
        },
        8_000,
      );
      raw.push({
        list: list.path,
        label: list.label,
        status: result.status,
        hits: result.ok ? asList(result.json).length : 0,
      });
      if (result.status === 0) continue;
      reached = true;
      if (!result.ok) continue;
      for (const row of asList(result.json).slice(0, 8)) {
        const item = asRecord(row);
        const name = String(item.nome ?? ctx.target);
        const process = String(item.numeroProcessoFormatado ?? '');
        const until = String(item.dataFinalSancao ?? item.dataFinalFinsEleitorais ?? '');
        findings.push({
          category: 'SANCTION',
          title: `${list.label}: ${name}`,
          summary: [
            process && `Processo ${process}`,
            item.numeroAcordaoFormatado && `Acórdão ${item.numeroAcordaoFormatado}`,
            until && `até ${until}`,
          ]
            .filter(Boolean)
            .join(' · '),
          details: item,
          confidence: 94,
          url: String(item.linkDeliberacoesProcesso ?? 'https://certidoes.apps.tcu.gov.br'),
        });
      }
    }

    if (!reached) return skipped('TCU não respondeu a tempo');
    if (findings.length === 0) {
      return ok(
        [
          {
            category: 'SANCTION',
            title: 'Nenhuma sanção TCU',
            summary: 'Consulta oficial sem inidoneidade, inabilitação ou contas irregulares',
            details: body,
            confidence: 90,
            url: 'https://certidoes.apps.tcu.gov.br',
          },
        ],
        raw,
      );
    }
    return ok(findings, raw);
  },
};
