import { getEnv } from '../../../lib/intel-env.js';
import {
  digitsOnly,
  isValidCnpj,
  isValidCpf,
  isValidEmail,
  isValidPhone,
} from '../../../contracts/utils/document.util.js';
import { DATAJUD_TRIBUNAL_CATALOG } from '../datajud/endpoints.js';
import { portalFindingText } from '../facts.util.js';
import { asRecord, fetchJson } from '../http.util.js';
import type {
  DossierProvider,
  ProviderContext,
  ProviderFinding,
  ProviderResult,
} from '../types.js';
import {
  brasilApiDdd,
  dnsMx,
  emailRep,
  fbiWanted,
  gdeltNews,
  nominatim,
  queridoDiario,
  registroBr,
  wikipediaPt,
} from './free.js';
import { openSanctions } from './opensanctions.js';
import { osintUsername } from './osint.js';
import { pncp } from './pncp.js';
import { tcuSancoes } from './tcu.js';

function skipped(reason: string): ProviderResult {
  return { status: 'skipped', error: reason, findings: [] };
}

function isPublicHostname(host: string): boolean {
  const value = host.trim().toLowerCase();
  if (!value || value === 'localhost' || !value.includes('.')) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return false;
  return !value.endsWith('.local') && !value.endsWith('.internal');
}

function ok(findings: ProviderFinding[], rawPayload?: unknown, httpStatus = 200): ProviderResult {
  return { status: 'ok', httpStatus, rawPayload, findings };
}

function fromHttp(result: { ok: boolean; status: number }, name: string): ProviderResult | null {
  if (result.status === 0) return skipped(`${name} não respondeu a tempo`);
  if (result.status === 429) return { status: 'rate_limited', httpStatus: 429, findings: [] };
  if (result.status === 404) return skipped(`${name}: sem registro`);
  if (!result.ok) return skipped(`${name} indisponível no momento`);
  return null;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      out[current] = await fn(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) || 1 }, () => worker()));
  return out;
}

function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function searchNames(ctx: ProviderContext): string[] {
  const values = [
    ctx.partyName,
    ctx.targetType === 'NAME' ? ctx.target : '',
    ...(ctx.aliases ?? []),
  ]
    .map((item) => item?.trim() ?? '')
    .filter((item) => item.length > 3 && /[A-Za-zÀ-ÿ]/.test(item));
  const unique = new Set<string>();
  for (const value of values) {
    unique.add(value);
    const plain = stripAccents(value);
    if (plain !== value) unique.add(plain);
  }
  return [...unique].slice(0, 8);
}

export { searchNames as searchNamesForTest };

function cnpjOf(ctx: ProviderContext): string | null {
  if (ctx.targetType !== 'CNPJ') return null;
  const value = ctx.target.replace(/[./\s-]/g, '').toUpperCase();
  return isValidCnpj(value) ? value : null;
}

async function lookupCnpj(url: string): Promise<{ status: number; json: unknown; ok: boolean }> {
  const result = await fetchJson(url);
  return { status: result.status, json: result.json, ok: result.ok };
}

function socioFindings(data: Record<string, unknown>): ProviderFinding[] {
  const raw = Array.isArray(data.qsa) ? data.qsa : Array.isArray(data.socios) ? data.socios : [];
  return raw.slice(0, 8).flatMap((row) => {
    const item = asRecord(row);
    const nome = String(item.nome_socio ?? item.nome ?? item.name ?? '').trim();
    if (!nome) return [];
    const role = String(
      item.qualificacao_socio ?? item.qualificacao ?? item.qualificacao_representante ?? 'sócio',
    );
    return [
      {
        category: 'IDENTITY' as const,
        title: nome,
        summary: `Quadro societário · ${role}`,
        details: item,
        confidence: 88,
      },
    ];
  });
}

const minhaReceita: DossierProvider = {
  name: 'Minha Receita',
  category: 'IDENTITY',
  reliability: 'COMMUNITY',
  accepts: ['CNPJ'],
  phase: 'sync',
  rateMs: 200,
  async run(ctx) {
    const cnpj = cnpjOf(ctx);
    if (!cnpj) return skipped('CNPJ inválido');
    const result = await lookupCnpj(`https://minhareceita.org/${cnpj}`);
    const issue = fromHttp(result, 'Minha Receita');
    if (issue) return issue;
    const data = asRecord(result.json);
    return ok(
      [
        {
          category: 'IDENTITY',
          title: String(data.razao_social ?? data.nome ?? cnpj),
          summary: `Situação: ${String(data.descricao_situacao_cadastral ?? data.situacao ?? 'não informada')}`,
          details: data,
          confidence: 90,
          url: `https://minhareceita.org/${cnpj}`,
        },
        ...socioFindings(data),
      ],
      result.json,
      result.status,
    );
  },
};

const brasilApiCnpj: DossierProvider = {
  name: 'BrasilAPI CNPJ',
  category: 'IDENTITY',
  reliability: 'COMMUNITY',
  accepts: ['CNPJ'],
  phase: 'sync',
  rateMs: 200,
  async run(ctx) {
    const cnpj = cnpjOf(ctx);
    if (!cnpj) return skipped('CNPJ inválido');
    const result = await lookupCnpj(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
    const issue = fromHttp(result, 'BrasilAPI CNPJ');
    if (issue) return issue;
    const data = asRecord(result.json);
    return ok(
      [
        {
          category: 'IDENTITY',
          title: String(data.razao_social ?? data.nome_fantasia ?? cnpj),
          summary: `Porte ${String(data.porte ?? '-')} · CNAE ${String(data.cnae_fiscal_descricao ?? '-')}`,
          details: data,
          confidence: 85,
          url: `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`,
        },
      ],
      result.json,
      result.status,
    );
  },
};

const receitaWs: DossierProvider = {
  name: 'ReceitaWS',
  category: 'IDENTITY',
  reliability: 'THIRD_PARTY',
  accepts: ['CNPJ'],
  phase: 'sync',
  rateMs: 20_000,
  async run(ctx) {
    const cnpj = cnpjOf(ctx);
    if (!cnpj) return skipped('CNPJ inválido');
    const result = await lookupCnpj(`https://www.receitaws.com.br/v1/cnpj/${cnpj}`);
    const issue = fromHttp(result, 'ReceitaWS');
    if (issue) return issue;
    const data = asRecord(result.json);
    if (data.status === 'ERROR')
      return skipped(String(data.message ?? 'ReceitaWS sem dados para o CNPJ'));
    return ok(
      [
        {
          category: 'IDENTITY',
          title: String(data.nome ?? cnpj),
          summary: `Situação ${String(data.situacao ?? '-')} · ${String(data.municipio ?? '')}/${String(data.uf ?? '')}`,
          details: data,
          confidence: 80,
          url: `https://www.receitaws.com.br/v1/cnpj/${cnpj}`,
        },
        ...socioFindings(data),
      ],
      result.json,
      result.status,
    );
  },
};

const openCnpj: DossierProvider = {
  name: 'OpenCNPJ',
  category: 'IDENTITY',
  reliability: 'COMMUNITY',
  accepts: ['CNPJ'],
  phase: 'sync',
  rateMs: 200,
  async run(ctx) {
    const cnpj = cnpjOf(ctx);
    if (!cnpj) return skipped('CNPJ inválido');
    const result = await lookupCnpj(`https://api.opencnpj.org/${cnpj}`);
    const issue = fromHttp(result, 'OpenCNPJ');
    if (issue) return issue;
    const data = asRecord(result.json);
    return ok(
      [
        {
          category: 'IDENTITY',
          title: String(data.razao_social ?? data.nome_fantasia ?? cnpj),
          summary: `Situação ${String(data.situacao_cadastral ?? '-')} · ${String(data.municipio ?? '')}/${String(data.uf ?? '')}`,
          details: data,
          confidence: 86,
          url: `https://api.opencnpj.org/${cnpj}`,
        },
        ...socioFindings(data),
      ],
      result.json,
      result.status,
    );
  },
};

const viaCep: DossierProvider = {
  name: 'ViaCEP',
  category: 'ADDRESS',
  reliability: 'COMMUNITY',
  accepts: ['CNPJ'],
  phase: 'sync',
  rateMs: 200,
  async run(ctx) {
    const cnpj = cnpjOf(ctx);
    if (!cnpj) return skipped('CNPJ necessário para obter CEP da Receita');
    const receita = await lookupCnpj(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
    const cep = digitsOnly(String(asRecord(receita.json).cep ?? ''));
    if (cep.length !== 8) return skipped('CEP não encontrado na ficha cadastral');
    const result = await fetchJson(`https://viacep.com.br/ws/${cep}/json/`);
    const data = asRecord(result.json);
    if (data.erro) return skipped('CEP não encontrado no ViaCEP');
    return ok(
      [
        {
          category: 'ADDRESS',
          title: `${String(data.logradouro ?? '')} — ${String(data.bairro ?? '')}`,
          summary: `${String(data.localidade ?? '')}/${String(data.uf ?? '')} · CEP ${cep}`,
          details: data,
          confidence: 85,
          url: `https://viacep.com.br/ws/${cep}/json/`,
        },
      ],
      result.json,
      result.status,
    );
  },
};

const ibge: DossierProvider = {
  name: 'IBGE Localidades',
  category: 'ADDRESS',
  reliability: 'OFFICIAL',
  accepts: ['CNPJ'],
  phase: 'sync',
  rateMs: 200,
  async run(ctx) {
    const cnpj = cnpjOf(ctx);
    if (!cnpj) return skipped('CNPJ inválido');
    const receita = await lookupCnpj(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
    const cadastro = asRecord(receita.json);
    let ibgeCode = String(cadastro.codigo_municipio_ibge ?? cadastro.codigo_municipio ?? '');
    const cep = digitsOnly(String(cadastro.cep ?? ''));
    if (!ibgeCode && cep.length === 8) {
      const via = await fetchJson(`https://viacep.com.br/ws/${cep}/json/`);
      ibgeCode = String(asRecord(via.json).ibge ?? '');
    }
    if (!ibgeCode) return skipped('Código IBGE do município não encontrado');
    const result = await fetchJson(
      `https://servicodados.ibge.gov.br/api/v1/localidades/municipios/${ibgeCode}`,
    );
    const issue = fromHttp(result, 'IBGE');
    if (issue) return issue;
    const data = asRecord(result.json);
    const micro = asRecord(data.microrregiao);
    const meso = asRecord(micro.mesorregiao);
    const uf = asRecord(asRecord(meso.UF).sigla ? meso.UF : asRecord(data.regiao_imediata));
    return ok(
      [
        {
          category: 'ADDRESS',
          title: String(data.nome ?? `Município ${ibgeCode}`),
          summary: `IBGE ${ibgeCode} · UF ${String(asRecord(meso.UF).sigla ?? asRecord(uf).sigla ?? '-')}`,
          details: data,
          confidence: 90,
          url: `https://servicodados.ibge.gov.br/api/v1/localidades/municipios/${ibgeCode}`,
        },
      ],
      result.json,
      result.status,
    );
  },
};

const disify: DossierProvider = {
  name: 'Disify',
  category: 'BREACH',
  reliability: 'THIRD_PARTY',
  accepts: ['EMAIL'],
  phase: 'sync',
  rateMs: 300,
  async run(ctx) {
    if (ctx.targetType !== 'EMAIL' || !isValidEmail(ctx.target)) return skipped('E-mail inválido');
    const result = await fetchJson(
      `https://disify.com/api/email/${encodeURIComponent(ctx.target)}`,
    );
    const issue = fromHttp(result, 'Disify');
    if (issue) return issue;
    const data = asRecord(result.json);
    return ok(
      [
        {
          category: 'BREACH',
          title: `Validação de e-mail ${ctx.target}`,
          summary: `Disposable=${String(data.disposable ?? '-')} · DNS=${String(data.dns ?? '-')}`,
          details: data,
          confidence: 75,
        },
      ],
      result.json,
      result.status,
    );
  },
};

const hunter: DossierProvider = {
  name: 'Hunter.io',
  category: 'BREACH',
  reliability: 'THIRD_PARTY',
  accepts: ['EMAIL'],
  phase: 'sync',
  rateMs: 400,
  async run(ctx) {
    const key = getEnv().HUNTER_API_KEY.trim();
    if (!key) return skipped('HUNTER_API_KEY não configurada');
    if (ctx.targetType !== 'EMAIL' || !isValidEmail(ctx.target)) return skipped('E-mail inválido');
    const result = await fetchJson(
      `https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(ctx.target)}&api_key=${key}`,
    );
    const issue = fromHttp(result, 'Hunter.io');
    if (issue) return issue;
    const data = asRecord(asRecord(result.json).data);
    return ok(
      [
        {
          category: 'BREACH',
          title: `Hunter: ${String(data.status ?? 'verificado')}`,
          summary: `Score ${String(data.score ?? '-')} · SMTP ${String(data.smtp_check ?? '-')}`,
          details: data,
          confidence: 80,
        },
      ],
      result.json,
      result.status,
    );
  },
};

const phoneLib: DossierProvider = {
  name: 'libphonenumber',
  category: 'IDENTITY',
  reliability: 'COMMUNITY',
  accepts: ['PHONE'],
  phase: 'sync',
  rateMs: 0,
  async run(ctx) {
    if (ctx.targetType !== 'PHONE' || !isValidPhone(ctx.target))
      return skipped('Telefone inválido');
    const digits = digitsOnly(ctx.target);
    return ok([
      {
        category: 'IDENTITY',
        title: `Telefone ${digits}`,
        summary: `Formato brasileiro válido (${digits.length} dígitos)`,
        details: { digits, e164: `+55${digits.replace(/^55/, '')}` },
        confidence: 70,
      },
    ]);
  },
};

const veriphone: DossierProvider = {
  name: 'Veriphone',
  category: 'IDENTITY',
  reliability: 'THIRD_PARTY',
  accepts: ['PHONE'],
  phase: 'sync',
  rateMs: 400,
  async run(ctx) {
    const key = getEnv().VERIPHONE_API_KEY.trim();
    if (!key) return skipped('VERIPHONE_API_KEY não configurada');
    if (ctx.targetType !== 'PHONE') return skipped('Telefone necessário');
    const result = await fetchJson(
      `https://api.veriphone.io/v2/verify?phone=${encodeURIComponent(ctx.target)}&key=${key}`,
    );
    const issue = fromHttp(result, 'Veriphone');
    if (issue) return issue;
    const data = asRecord(result.json);
    return ok(
      [
        {
          category: 'IDENTITY',
          title: `Operadora ${String(data.carrier ?? 'não informada')}`,
          summary: `Tipo ${String(data.phone_type ?? '-')} · País ${String(data.country ?? '-')}`,
          details: data,
          confidence: 78,
        },
      ],
      result.json,
      result.status,
    );
  },
};

const portalTransparencia: DossierProvider = {
  name: 'Portal da Transparência',
  category: 'SANCTION',
  reliability: 'OFFICIAL',
  accepts: ['CPF', 'CNPJ'],
  phase: 'sync',
  rateMs: 200,
  async run(ctx) {
    const token = getEnv().PORTAL_TRANSPARENCIA_TOKEN.trim();
    if (!token) return skipped('PORTAL_TRANSPARENCIA_TOKEN não configurada');
    const document = ctx.targetType === 'CPF' ? digitsOnly(ctx.target) : cnpjOf(ctx);
    if (!document) return skipped('Documento inválido');
    const sanctionEndpoints = [
      { path: 'ceis', param: 'codigoSancionado', accepts: ['CPF', 'CNPJ'] },
      { path: 'cnep', param: 'codigoSancionado', accepts: ['CPF', 'CNPJ'] },
      { path: 'cepim', param: 'cnpjSancionado', accepts: ['CNPJ'] },
      { path: 'ceaf', param: 'cpfSancionado', accepts: ['CPF'] },
      { path: 'acordos-leniencia', param: 'cnpjSancionado', accepts: ['CNPJ'] },
    ] as const;
    const findings: ProviderFinding[] = [];
    const raw: unknown[] = [];
    for (const endpoint of sanctionEndpoints) {
      if (!(endpoint.accepts as readonly string[]).includes(ctx.targetType)) continue;
      const result = await fetchJson(
        `https://api.portaldatransparencia.gov.br/api-de-dados/${endpoint.path}?${endpoint.param}=${document}&pagina=1`,
        { headers: { 'chave-api-dados': token } },
      );
      raw.push({ endpoint: endpoint.path, status: result.status, body: result.json });
      const rows = Array.isArray(result.json) ? result.json : [];
      for (const row of rows.slice(0, 10)) {
        const item = asRecord(row);
        const sanctioned = asRecord(item.sancionado);
        const rowDoc = digitsOnly(
          String(
            item.codigoSancionado ??
              item.cpfSancionado ??
              item.cnpjSancionado ??
              sanctioned.codigo ??
              sanctioned.cpfFormatado ??
              sanctioned.cnpj ??
              item.cpf ??
              '',
          ),
        );
        if (rowDoc && rowDoc !== document) continue;
        if (!rowDoc && rows.length >= 8) continue;
        const text = portalFindingText(item, document);
        findings.push({
          category: 'SANCTION',
          title: `${endpoint.path.toUpperCase()}: ${text.titleName}`,
          summary: text.summary,
          details: item,
          confidence: 95,
          url: 'https://portaldatransparencia.gov.br',
        });
      }
    }
    if (!findings.some((item) => item.category === 'SANCTION')) {
      findings.push({
        category: 'SANCTION',
        title: 'Nenhuma sanção CEIS/CNEP/CEPIM/CEAF/leniência',
        summary: 'Consulta oficial sem registros para o documento informado',
        details: { document },
        confidence: 88,
      });
    }
    if (ctx.targetType === 'CPF') {
      const pep = await fetchJson(
        `https://api.portaldatransparencia.gov.br/api-de-dados/peps?cpf=${document}&pagina=1`,
        { headers: { 'chave-api-dados': token } },
      );
      raw.push({ endpoint: 'pep', status: pep.status, body: pep.json });
      const rows = Array.isArray(pep.json) ? pep.json : [];
      if (rows.length === 0) {
        findings.push({
          category: 'ELECTORAL',
          title: 'Não consta no cadastro de PEP da CGU',
          summary: 'Consulta oficial sem registro de pessoa politicamente exposta para este CPF',
          details: { document },
          confidence: 86,
          url: 'https://portaldatransparencia.gov.br',
        });
      } else {
        for (const row of rows.slice(0, 8)) {
          const item = asRecord(row);
          findings.push({
            category: 'ELECTORAL',
            title: `PEP: ${String(item.nome ?? item.nomePep ?? document)}`,
            summary: String(
              item.descricaoFuncao ??
                item.funcao ??
                item.siglaFuncao ??
                'Pessoa politicamente exposta',
            ),
            details: item,
            confidence: 93,
            url: 'https://portaldatransparencia.gov.br',
          });
        }
      }
    }
    return ok(findings, raw);
  },
};

function dataJudQuery(ctx: ProviderContext): Record<string, unknown> {
  const should: Record<string, unknown>[] = [];
  for (const name of searchNames(ctx)) {
    should.push({ match_phrase: { 'partes.nome': { query: name, slop: 1 } } });
  }
  if (ctx.targetType === 'CPF' || ctx.targetType === 'CNPJ') {
    const document = ctx.target.replace(/\D/g, '');
    if (document) {
      should.push({ match: { 'partes.documento': document } });
      should.push({ term: { 'partes.documento.keyword': document } });
    }
  }
  return { bool: { should, minimum_should_match: 1 } };
}

async function searchDataJud(ctx: ProviderContext, aliases: string[]): Promise<ProviderResult> {
  const apiKey = getEnv().DATAJUD_API_KEY.trim();
  if (!apiKey) return skipped('DataJud sem chave configurada');
  const query = dataJudQuery(ctx);
  const validAliases = aliases.filter((alias) =>
    DATAJUD_TRIBUNAL_CATALOG.some((item) => item.alias === alias),
  );
  const rows = await mapLimit(validAliases, 4, async (alias) => {
    const result = await fetchJson(
      `https://api-publica.datajud.cnj.jus.br/api_publica_${alias}/_search`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `APIKey ${apiKey}`,
        },
        body: JSON.stringify({ size: 8, query, sort: [{ dataAjuizamento: { order: 'desc' } }] }),
      },
      6_000,
    );
    const hits = asRecord(asRecord(result.json).hits).hits;
    const list = Array.isArray(hits) ? hits : [];
    const findings: ProviderFinding[] = list.slice(0, 6).map((hit) => {
      const source = asRecord(asRecord(hit)._source);
      const filed = String(source.dataAjuizamento ?? '');
      return {
        category: 'LAWSUIT' as const,
        title: String(source.numeroProcesso ?? 'Processo sem número'),
        summary: `${alias.toUpperCase()} · ${String(asRecord(source.classe).nome ?? 'classe n/d')}${
          filed ? ` · ajuizado ${filed.slice(0, 10)}` : ''
        }`,
        details: source,
        confidence: 84,
        url: `https://api-publica.datajud.cnj.jus.br/api_publica_${alias}/_search`,
        occurredAt: filed ? new Date(filed) : undefined,
      };
    });
    return { alias, status: result.status, ok: result.ok, findings };
  });
  const findings = rows.flatMap((row) => row.findings);
  const consulted = rows.filter((row) => row.ok).map((row) => row.alias);
  if (findings.length === 0 && consulted.length === 0) {
    return skipped('DataJud indisponível nos tribunais consultados');
  }
  if (findings.length === 0) {
    return ok(
      [
        {
          category: 'LAWSUIT',
          title: 'Nenhum processo encontrado no DataJud',
          summary: `Consulta em ${consulted.join(', ')} sem processos para este identificador`,
          details: { aliases: consulted },
          confidence: 62,
        },
      ],
      rows.map((row) => ({ alias: row.alias, status: row.status, hits: row.findings.length })),
    );
  }
  return ok(
    findings,
    rows.map((row) => ({ alias: row.alias, status: row.status, hits: row.findings.length })),
  );
}

const datajudSync: DossierProvider = {
  name: 'DataJud CNJ',
  category: 'LAWSUIT',
  reliability: 'OFFICIAL',
  accepts: ['CPF', 'CNPJ', 'NAME'],
  phase: 'sync',
  rateMs: 400,
  async run(ctx) {
    const aliases = getEnv()
      .DATAJUD_TRIBUNAIS.split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
    return searchDataJud(ctx, aliases);
  },
};

const datajudDeep: DossierProvider = {
  name: 'DataJud processos completos',
  category: 'LAWSUIT',
  reliability: 'OFFICIAL',
  accepts: ['CPF', 'CNPJ', 'NAME'],
  phase: 'async',
  rateMs: 800,
  async run(ctx) {
    const aliases = getEnv()
      .DATAJUD_TRIBUNAIS_DEEP.split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
    return searchDataJud(ctx, aliases);
  },
};

const datajudIntimacoes: DossierProvider = {
  name: 'DataJud intimações',
  category: 'INTIMACAO',
  reliability: 'OFFICIAL',
  accepts: ['CPF', 'CNPJ', 'NAME'],
  phase: 'async',
  rateMs: 800,
  async run(ctx) {
    const findings: ProviderFinding[] = [];
    for (const prior of (ctx.priorFindings ?? []).filter((item) => item.category === 'LAWSUIT')) {
      const movimentos = Array.isArray(prior.details.movimentos) ? prior.details.movimentos : [];
      for (const movimento of movimentos) {
        const item = asRecord(movimento);
        const label = String(item.nome ?? '');
        if (!/intima/i.test(label)) continue;
        findings.push({
          category: 'INTIMACAO',
          title: label || 'Intimação',
          summary: `${prior.title} · ${String(item.dataHora ?? 'data n/d')}`,
          details: { processo: prior.title, movimento: item },
          confidence: 80,
          occurredAt: item.dataHora ? new Date(String(item.dataHora)) : undefined,
        });
      }
    }
    if (findings.length === 0) {
      return ok([
        {
          category: 'INTIMACAO',
          title: 'Nenhuma intimação nos processos já localizados',
          summary: 'Os movimentos do DataJud consultado não trouxeram intimação explícita',
          details: {},
          confidence: 50,
        },
      ]);
    }
    return ok(findings.slice(0, 20));
  },
};

const googleNews: DossierProvider = {
  name: 'Google News RSS',
  category: 'NEWS',
  reliability: 'THIRD_PARTY',
  accepts: ['CNPJ', 'CPF', 'NAME', 'EMAIL'],
  phase: 'async',
  rateMs: 500,
  async run(ctx) {
    const term = searchNames(ctx).find((item) => /[A-Za-zÀ-ÿ]/.test(item));
    if (!term) return skipped('Notícias precisam de nome, não só documento');
    const query = encodeURIComponent(`"${term}"`);
    const url = `https://news.google.com/rss/search?q=${query}&hl=pt-419&gl=BR&ceid=BR:pt-419`;
    const result = await fetchJson(
      url,
      { headers: { Accept: 'application/rss+xml, text/xml' } },
      8_000,
    );
    if (!result.ok && !result.text) return skipped('Google News não respondeu');
    const titles = [...result.text.matchAll(/<title><!\[CDATA\[(.*?)\]\]><\/title>/g)].map(
      (match) => match[1],
    );
    const findings = titles.slice(1, 16).map((title) => ({
      category: 'NEWS' as const,
      title,
      summary: `Notícia indexada no Google News para "${ctx.partyName ?? ctx.target}"`,
      details: { title },
      confidence: 55,
      url,
    }));
    return ok(
      findings.length
        ? findings
        : [
            {
              category: 'NEWS',
              title: 'Sem notícias recentes',
              summary: 'Google News RSS não retornou itens para o termo',
              details: {},
              confidence: 40,
              url,
            },
          ],
      { count: titles.length },
      result.status,
    );
  },
};

const interpol: DossierProvider = {
  name: 'Interpol Notices',
  category: 'TRAVEL_DOC',
  reliability: 'OFFICIAL',
  accepts: ['NAME', 'PASSAPORTE'],
  phase: 'async',
  rateMs: 600,
  async run(ctx) {
    const base = getEnv().INTERPOL_API_BASE.replace(/\/$/, '');
    const fullName = searchNames(ctx)[0] ?? ctx.target;
    const parts = fullName.trim().split(/\s+/);
    const name = parts.at(-1) ?? ctx.target;
    const forename = parts.slice(0, -1).join(' ');
    const qs = new URLSearchParams({ name, resultPerPage: '20' });
    if (forename) qs.set('forename', forename);
    const result = await fetchJson(`${base}/red?${qs.toString()}`, {}, 8_000);
    const issue = fromHttp(result, 'Interpol');
    if (issue) return issue;
    const embedded = asRecord(asRecord(result.json)._embedded);
    const notices = Array.isArray(embedded.notices) ? embedded.notices : [];
    const findings = notices.slice(0, 10).map((notice) => {
      const item = asRecord(notice);
      return {
        category: 'TRAVEL_DOC' as const,
        title: `Red Notice ${String(item.entity_id ?? '')}`,
        summary: `${String(item.forename ?? '')} ${String(item.name ?? '')}`.trim(),
        details: item,
        confidence: 70,
        url: `${base}/red`,
      };
    });
    return ok(
      findings.length
        ? findings
        : [
            {
              category: 'TRAVEL_DOC',
              title: 'Nenhuma Red Notice pública',
              summary: 'API Interpol sem correspondência para o nome informado',
              details: {},
              confidence: 65,
            },
          ],
      result.json,
      result.status,
    );
  },
};

const domain: DossierProvider = {
  name: 'RDAP + crt.sh',
  category: 'DOMAIN',
  reliability: 'OFFICIAL',
  accepts: ['EMAIL', 'NAME', 'CNPJ'],
  phase: 'async',
  rateMs: 500,
  async run(ctx) {
    const domainHint = ctx.targetType === 'EMAIL' ? ctx.target.split('@')[1] : undefined;
    if (!domainHint) return skipped('Domínio só é inferido a partir de e-mail');
    if (!isPublicHostname(domainHint)) return skipped('Domínio inválido ou privado');
    const rdap = await fetchJson(`https://rdap.org/domain/${domainHint}`);
    const crt = await fetchJson(`https://crt.sh/?q=${encodeURIComponent(domainHint)}&output=json`);
    return ok(
      [
        {
          category: 'DOMAIN',
          title: `Domínio ${domainHint}`,
          summary: `RDAP ${rdap.status} · certificados crt.sh ${Array.isArray(crt.json) ? crt.json.length : 0}`,
          details: {
            rdap: rdap.json,
            certificates: Array.isArray(crt.json) ? crt.json.slice(0, 5) : [],
          },
          confidence: 72,
          url: `https://rdap.org/domain/${domainHint}`,
        },
      ],
      { rdap: rdap.status, crt: crt.status },
    );
  },
};

const wikidata: DossierProvider = {
  name: 'Wikidata',
  category: 'IDENTITY',
  reliability: 'COMMUNITY',
  accepts: ['NAME', 'CNPJ'],
  phase: 'async',
  rateMs: 400,
  async run(ctx) {
    const term = (searchNames(ctx)[0] ?? ctx.target).replace(/"/g, '');
    if (term.length < 5) return skipped('Termo curto demais para Wikidata');
    const sparql = `SELECT ?item ?itemLabel ?itemDescription WHERE {
      ?item rdfs:label "${term}"@pt.
      SERVICE wikibase:label { bd:serviceParam wikibase:language "pt,en". }
    } LIMIT 5`;
    const result = await fetchJson(
      `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`,
      { headers: { Accept: 'application/sparql-results+json' } },
      8_000,
    );
    const issue = fromHttp(result, 'Wikidata');
    if (issue) return issue;
    const bindings = asRecord(asRecord(result.json).results).bindings;
    const rows = Array.isArray(bindings) ? bindings : [];
    const findings = rows
      .map((row) => {
        const item = asRecord(row);
        const label = String(asRecord(item.itemLabel).value ?? '');
        const description = String(asRecord(item.itemDescription).value ?? 'Entidade pública');
        const uri = String(asRecord(item.item).value ?? '');
        return {
          category: 'IDENTITY' as const,
          title: label || term,
          summary: description,
          details: item,
          confidence: 68,
          url: uri || undefined,
        };
      })
      .filter((finding) => finding.title);
    if (findings.length === 0) {
      return skipped('Wikidata sem entidade com esse rótulo em português');
    }
    return ok(findings, { count: findings.length });
  },
};

const tse: DossierProvider = {
  name: 'TSE candidaturas',
  category: 'ELECTORAL',
  reliability: 'OFFICIAL',
  accepts: ['NAME', 'CPF'],
  phase: 'async',
  rateMs: 500,
  async run() {
    return skipped('TSE exige carga dos CSVs oficiais; consulta automática ainda não está ligada');
  },
};

const reclameAqui: DossierProvider = {
  name: 'Reclame Aqui',
  category: 'REPUTATION',
  reliability: 'THIRD_PARTY',
  accepts: ['CNPJ', 'NAME'],
  phase: 'async',
  rateMs: 800,
  async run(ctx) {
    const term = searchNames(ctx)[0] ?? cnpjOf(ctx) ?? '';
    if (term.length < 3) return skipped('Reclame Aqui precisa de nome ou razão social');
    const result = await fetchJson(
      `https://iosearch.reclameaqui.com.br/raichu-io-site-search-v1/companies/search/${encodeURIComponent(term)}`,
      { headers: { Accept: 'application/json' } },
      8_000,
    );
    if (result.ok) {
      const payload = asRecord(result.json);
      const rows = Array.isArray(payload.companies)
        ? payload.companies
        : Array.isArray(payload.data)
          ? payload.data
          : Array.isArray(result.json)
            ? result.json
            : [];
      const findings = rows.slice(0, 5).flatMap((row) => {
        const item = asRecord(row);
        const name = String(item.companyName ?? item.nome ?? item.name ?? term);
        const slug = String(item.shortname ?? item.slug ?? '');
        const score = item.finalScore ?? item.score ?? item.nota;
        return [
          {
            category: 'REPUTATION' as const,
            title: name,
            summary:
              score != null
                ? `Nota ${String(score)} no Reclame Aqui`
                : 'Empresa indexada no Reclame Aqui',
            details: item,
            confidence: 68,
            url: slug
              ? `https://www.reclameaqui.com.br/empresa/${slug}/`
              : 'https://www.reclameaqui.com.br',
          },
        ];
      });
      if (findings.length) return ok(findings, result.json, result.status);
    }

    const token = getEnv().APIFY_API_TOKEN.trim();
    const cnpj = cnpjOf(ctx);
    if (!token || !cnpj) {
      return skipped('Reclame Aqui sem correspondência na busca pública');
    }
    const paid = await fetchJson(
      `https://api.apify.com/v2/acts/brasildados~reputation-checker/run-sync-get-dataset-items?token=${token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cnpjs: [cnpj] }),
      },
      45_000,
    );
    const issue = fromHttp(paid, 'Reclame Aqui');
    if (issue) return issue;
    const rows = Array.isArray(paid.json) ? paid.json : [];
    const first = asRecord(rows[0]);
    return ok(
      [
        {
          category: 'REPUTATION',
          title: `Nota ${String(first.notaUnificada ?? first.notaUnificada90Dias ?? 'n/d')}`,
          summary: 'Reputação consolidada via Apify / Reclame Aqui',
          details: first,
          confidence: 74,
        },
      ],
      paid.json,
      paid.status,
    );
  },
};

const bnmp: DossierProvider = {
  name: 'BNMP 3.0',
  category: 'MANDADO',
  reliability: 'OFFICIAL',
  accepts: ['NAME', 'CPF'],
  phase: 'async',
  rateMs: 1500,
  async run() {
    return skipped('BNMP 3.0 exige captcha no portal público; automação desligada');
  },
};

const dou: DossierProvider = {
  name: 'DOU',
  category: 'INTIMACAO',
  reliability: 'OFFICIAL',
  accepts: ['NAME', 'CPF', 'CNPJ'],
  phase: 'async',
  rateMs: 1000,
  async run() {
    return skipped('DOU ainda depende da base XML mensal da Imprensa Nacional');
  },
};

const ofac: DossierProvider = {
  name: 'OFAC SDN',
  category: 'SANCTION',
  reliability: 'OFFICIAL',
  accepts: ['NAME', 'CNPJ', 'CPF'],
  phase: 'async',
  rateMs: 1000,
  async run(ctx) {
    const needles = searchNames(ctx)
      .map((item) => item.toLowerCase())
      .filter((item) => item.length > 4);
    if (needles.length === 0) return skipped('OFAC precisa de nome para cruzar a SDN');
    const result = await fetchJson(
      'https://www.treasury.gov/ofac/downloads/sdn.xml',
      { headers: { Accept: 'application/xml, text/xml' } },
      10_000,
    );
    if (!result.ok || result.text.length < 200) return skipped('Lista OFAC SDN indisponível');
    const haystack = result.text.toLowerCase();
    const needle = needles.find((item) => haystack.includes(item));
    const hit = Boolean(needle);
    return ok(
      [
        {
          category: 'SANCTION',
          title: hit ? 'Possível correspondência OFAC' : 'Sem hit OFAC no recorte textual',
          summary: hit
            ? `O termo "${needle}" aparece na lista SDN`
            : 'Nenhuma ocorrência textual na SDN baixada',
          details: { matched: hit, bytes: result.text.length },
          confidence: hit ? 70 : 60,
          url: 'https://sanctionslistservice.ofac.treas.gov/api/download/SDN.XML',
        },
      ],
      { matched: hit },
      result.status,
    );
  },
};

function paidStub(name: string): DossierProvider {
  return {
    name,
    category: 'FINANCIAL',
    reliability: 'PAID',
    accepts: ['CPF', 'CNPJ', 'NAME'],
    phase: 'async',
    rateMs: 0,
    async run() {
      const enabled = getEnv()
        .PAID_PROVIDERS_ENABLED.split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
      const key = name.toLowerCase().replace(/\s+/g, '-');
      if (!enabled.includes(key)) {
        return skipped(`${name} desativado (PAID_PROVIDERS_ENABLED)`);
      }
      return skipped(`${name} marcado, integração comercial ainda não configurada`);
    },
  };
}

export const DOSSIER_PROVIDERS: DossierProvider[] = [
  minhaReceita,
  brasilApiCnpj,
  receitaWs,
  openCnpj,
  datajudSync,
  portalTransparencia,
  viaCep,
  ibge,
  nominatim,
  disify,
  hunter,
  emailRep,
  brasilApiDdd,
  phoneLib,
  veriphone,
  datajudDeep,
  datajudIntimacoes,
  googleNews,
  gdeltNews,
  interpol,
  fbiWanted,
  wikidata,
  wikipediaPt,
  domain,
  registroBr,
  dnsMx,
  tse,
  reclameAqui,
  queridoDiario,
  osintUsername,
  pncp,
  tcuSancoes,
  openSanctions,
  bnmp,
  dou,
  ofac,
  paidStub('Bigdata Corp'),
  paidStub('Jusbrasil'),
];

export function providersFor(ctx: ProviderContext, phase: 'sync' | 'async'): DossierProvider[] {
  const paid = new Set(ctx.paidProviders.map((item) => item.trim().toLowerCase()));
  return DOSSIER_PROVIDERS.filter((provider) => {
    if (provider.phase !== phase) return false;
    if (!provider.accepts.includes(ctx.targetType)) return false;
    if (provider.reliability === 'PAID') {
      return paid.has(provider.name.toLowerCase().replace(/\s+/g, '-'));
    }
    return true;
  });
}

export function isValidTarget(type: ProviderContext['targetType'], value: string): boolean {
  if (type === 'CPF') return isValidCpf(value);
  if (type === 'CNPJ') return isValidCnpj(value);
  if (type === 'EMAIL') return isValidEmail(value);
  if (type === 'PHONE') return isValidPhone(value);
  if (type === 'NAME') return value.trim().split(/\s+/).length >= 2;
  if (type === 'PASSAPORTE') return /^[A-Z0-9]{6,12}$/i.test(value.trim());
  return false;
}
