import {
  digitsOnly,
  isValidCnpj,
  isValidEmail,
  isValidPhone,
} from '../../../contracts/utils/document.util.js';
import { asRecord, fetchJson } from '../http.util.js';
import type { DossierProvider, ProviderContext, ProviderFinding } from '../types.js';

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
  return [...new Set(values)].slice(0, 4);
}

function cnpjOf(ctx: ProviderContext): string | null {
  if (ctx.targetType !== 'CNPJ') return null;
  const value = ctx.target.replace(/[./\s-]/g, '').toUpperCase();
  return isValidCnpj(value) ? value : null;
}

function emailDomain(ctx: ProviderContext): string | null {
  if (ctx.targetType !== 'EMAIL' || !isValidEmail(ctx.target)) return null;
  return ctx.target.split('@')[1]?.toLowerCase() || null;
}

export const brasilApiDdd: DossierProvider = {
  name: 'BrasilAPI DDD',
  category: 'IDENTITY',
  reliability: 'COMMUNITY',
  accepts: ['PHONE'],
  phase: 'sync',
  rateMs: 200,
  async run(ctx) {
    if (ctx.targetType !== 'PHONE' || !isValidPhone(ctx.target))
      return skipped('Telefone inválido');
    const digits = digitsOnly(ctx.target).replace(/^55/, '');
    const ddd = digits.slice(0, 2);
    if (ddd.length !== 2) return skipped('DDD não identificado');
    const result = await fetchJson(`https://brasilapi.com.br/api/ddd/v1/${ddd}`);
    if (result.status === 404) return skipped(`DDD ${ddd} não encontrado`);
    if (!result.ok) return skipped('BrasilAPI DDD indisponível');
    const data = asRecord(result.json);
    const cities = Array.isArray(data.cities) ? data.cities.slice(0, 8).map(String) : [];
    return ok(
      [
        {
          category: 'IDENTITY',
          title: `DDD ${ddd} · ${String(data.state ?? '-')}`,
          summary: cities.length ? `Cidades: ${cities.join(', ')}` : 'Área de registro do DDD',
          details: data,
          confidence: 82,
          url: `https://brasilapi.com.br/api/ddd/v1/${ddd}`,
        },
      ],
      result.json,
      result.status,
    );
  },
};

export const registroBr: DossierProvider = {
  name: 'Registro.br',
  category: 'DOMAIN',
  reliability: 'OFFICIAL',
  accepts: ['EMAIL'],
  phase: 'sync',
  rateMs: 200,
  async run(ctx) {
    const domain = emailDomain(ctx);
    if (!domain) return skipped('Domínio só é inferido a partir de e-mail');
    if (!domain.endsWith('.br')) return skipped('Registro.br cobre apenas domínios .br');
    const result = await fetchJson(
      `https://brasilapi.com.br/api/registrobr/v1/${encodeURIComponent(domain)}`,
    );
    if (!result.ok) return skipped('Registro.br indisponível');
    const data = asRecord(result.json);
    return ok(
      [
        {
          category: 'DOMAIN',
          title: `Domínio ${domain}`,
          summary: `Status ${String(data.status ?? '-')} · titular ${String(data.hosts ? 'com hosts' : 'consulta WHOIS .br')}`,
          details: data,
          confidence: 80,
          url: `https://registro.br/tecnologia/ferramentas/whois?search=${encodeURIComponent(domain)}`,
        },
      ],
      result.json,
      result.status,
    );
  },
};

export const dnsMx: DossierProvider = {
  name: 'DNS MX',
  category: 'DOMAIN',
  reliability: 'OFFICIAL',
  accepts: ['EMAIL'],
  phase: 'sync',
  rateMs: 200,
  async run(ctx) {
    const domain = emailDomain(ctx);
    if (!domain) return skipped('Domínio só é inferido a partir de e-mail');
    const result = await fetchJson(
      `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`,
    );
    if (!result.ok) return skipped('DNS Google indisponível');
    const answers = asList(asRecord(result.json).Answer);
    const hosts = answers
      .map((item) =>
        String(asRecord(item).data ?? '')
          .replace(/\d+\s+/, '')
          .replace(/\.$/, ''),
      )
      .filter(Boolean)
      .slice(0, 6);
    return ok(
      [
        {
          category: 'DOMAIN',
          title: hosts.length ? `MX de ${domain}` : `Sem MX público em ${domain}`,
          summary: hosts.length ? hosts.join(', ') : 'Nenhum servidor de e-mail publicado no DNS',
          details: { hosts, raw: result.json },
          confidence: hosts.length ? 78 : 55,
          url: `https://dns.google/query?name=${encodeURIComponent(domain)}&type=MX`,
        },
      ],
      result.json,
      result.status,
    );
  },
};

export const emailRep: DossierProvider = {
  name: 'EmailRep',
  category: 'BREACH',
  reliability: 'THIRD_PARTY',
  accepts: ['EMAIL'],
  phase: 'async',
  rateMs: 400,
  async run(ctx) {
    if (ctx.targetType !== 'EMAIL' || !isValidEmail(ctx.target)) return skipped('E-mail inválido');
    const result = await fetchJson(
      `https://emailrep.io/${encodeURIComponent(ctx.target)}`,
      {},
      8_000,
    );
    if (result.status === 429) return { status: 'rate_limited', httpStatus: 429, findings: [] };
    if (!result.ok) return skipped('EmailRep indisponível no momento');
    const data = asRecord(result.json);
    const details = asRecord(data.details);
    const leaked = Boolean(details.credentials_leaked || details.data_breach);
    return ok(
      [
        {
          category: 'BREACH',
          title: `EmailRep ${String(data.reputation ?? 'n/d')}`,
          summary: leaked
            ? 'Há indício de vazamento ou credencial exposta'
            : `Risco ${String(data.suspicious ? 'elevado' : 'baixo')} · reputação pública do e-mail`,
          details: data,
          confidence: 72,
          url: `https://emailrep.io/${encodeURIComponent(ctx.target)}`,
        },
      ],
      result.json,
      result.status,
    );
  },
};

export const wikipediaPt: DossierProvider = {
  name: 'Wikipedia PT',
  category: 'IDENTITY',
  reliability: 'COMMUNITY',
  accepts: ['NAME', 'CNPJ', 'CPF'],
  phase: 'async',
  rateMs: 300,
  async run(ctx) {
    const term = namesOf(ctx)[0];
    if (!term) return skipped('Wikipedia precisa de nome');
    const result = await fetchJson(
      `https://pt.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(term)}&utf8=1&format=json&srlimit=5`,
      { headers: { Accept: 'application/json' } },
      8_000,
    );
    if (!result.ok) return skipped('Wikipedia indisponível');
    const hits = asRecord(asRecord(result.json).query).search;
    const rows = Array.isArray(hits) ? hits : [];
    const findings = rows.slice(0, 5).flatMap((row) => {
      const item = asRecord(row);
      const title = String(item.title ?? '');
      if (!title) return [];
      return [
        {
          category: 'IDENTITY' as const,
          title,
          summary: String(item.snippet ?? 'Página na Wikipedia em português').replace(
            /<[^>]+>/g,
            '',
          ),
          details: item,
          confidence: 58,
          url: `https://pt.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
        },
      ];
    });
    if (!findings.length) return skipped('Wikipedia sem página para este nome');
    return ok(findings, { count: findings.length });
  },
};

export const nominatim: DossierProvider = {
  name: 'OpenStreetMap Nominatim',
  category: 'ADDRESS',
  reliability: 'COMMUNITY',
  accepts: ['CNPJ'],
  phase: 'async',
  rateMs: 1100,
  async run(ctx) {
    const cnpj = cnpjOf(ctx);
    if (!cnpj) return skipped('CNPJ inválido');
    const receita = await fetchJson(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
    const data = asRecord(receita.json);
    const parts = [data.logradouro, data.numero, data.bairro, data.municipio, data.uf, 'Brasil']
      .map((item) => String(item ?? '').trim())
      .filter(Boolean);
    if (parts.length < 3) return skipped('Endereço da Receita insuficiente para geocodificar');
    const query = parts.join(', ');
    const result = await fetchJson(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(query)}`,
      { headers: { Accept: 'application/json' } },
      8_000,
    );
    const places = Array.isArray(result.json) ? result.json : [];
    if (!result.ok || places.length === 0) {
      return skipped('Nominatim sem ponto geográfico para o endereço');
    }
    const place = asRecord(places[0]);
    return ok(
      [
        {
          category: 'ADDRESS',
          title: String(place.display_name ?? query),
          summary: `Lat ${String(place.lat ?? '-')} · Lon ${String(place.lon ?? '-')}`,
          details: place,
          confidence: 70,
          url: `https://www.openstreetmap.org/?mlat=${String(place.lat ?? '')}&mlon=${String(place.lon ?? '')}`,
        },
      ],
      result.json,
      result.status,
    );
  },
};

export const queridoDiario: DossierProvider = {
  name: 'Querido Diário',
  category: 'INTIMACAO',
  reliability: 'COMMUNITY',
  accepts: ['NAME', 'CNPJ', 'CPF'],
  phase: 'async',
  rateMs: 400,
  async run(ctx) {
    const term = namesOf(ctx)[0] ?? cnpjOf(ctx);
    if (!term || term.length < 5) return skipped('Querido Diário precisa de nome ou CNPJ');
    const result = await fetchJson(
      `https://api.queridodiario.ok.org.br/gazettes?querystring=${encodeURIComponent(term)}&size=8&excerpt_size=180`,
      {},
      10_000,
    );
    if (!result.ok) return skipped('Querido Diário indisponível');
    const gazettes = asList(asRecord(result.json).gazettes);
    const findings = gazettes.slice(0, 8).flatMap((row) => {
      const item = asRecord(row);
      const excerpts = Array.isArray(item.excerpts) ? item.excerpts : [];
      const excerpt = String(excerpts[0] ?? item.date ?? 'Menção em diário oficial municipal');
      return [
        {
          category: 'INTIMACAO' as const,
          title: `${String(item.territory_name ?? 'Município')} · ${String(item.date ?? '')}`,
          summary: excerpt.replace(/\s+/g, ' ').slice(0, 240),
          details: item,
          confidence: 66,
          url: String(item.url ?? 'https://queridodiario.ok.org.br'),
          occurredAt: item.date ? new Date(String(item.date)) : undefined,
        },
      ];
    });
    if (!findings.length) return skipped('Nenhuma menção em diários municipais indexados');
    return ok(findings, { total: asRecord(result.json).total_gazettes ?? findings.length });
  },
};

export const gdeltNews: DossierProvider = {
  name: 'GDELT News',
  category: 'NEWS',
  reliability: 'THIRD_PARTY',
  accepts: ['NAME', 'CNPJ', 'CPF', 'EMAIL'],
  phase: 'async',
  rateMs: 400,
  async run(ctx) {
    const term = namesOf(ctx)[0];
    if (!term) return skipped('GDELT precisa de nome');
    const result = await fetchJson(
      `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(`"${term}"`)}&mode=artlist&maxrecords=10&format=json&sort=datedesc`,
      {},
      10_000,
    );
    if (!result.ok) return skipped('GDELT indisponível');
    const articles = asList(asRecord(result.json).articles);
    const findings = articles.slice(0, 10).flatMap((row) => {
      const item = asRecord(row);
      const title = String(item.title ?? '');
      if (!title) return [];
      return [
        {
          category: 'NEWS' as const,
          title,
          summary: `${String(item.domain ?? 'fonte')} · ${String(item.sourcecountry ?? '')}`.trim(),
          details: item,
          confidence: 52,
          url: String(item.url ?? ''),
        },
      ];
    });
    if (!findings.length) return skipped('GDELT sem notícias para o termo');
    return ok(findings, { count: findings.length });
  },
};

export const fbiWanted: DossierProvider = {
  name: 'FBI Wanted',
  category: 'MANDADO',
  reliability: 'OFFICIAL',
  accepts: ['NAME', 'PASSAPORTE'],
  phase: 'async',
  rateMs: 400,
  async run(ctx) {
    const term = namesOf(ctx)[0] ?? ctx.target;
    if (term.length < 5) return skipped('FBI precisa de nome');
    const result = await fetchJson(
      `https://api.fbi.gov/wanted/v1/list?title=${encodeURIComponent(term)}`,
      {},
      8_000,
    );
    if (!result.ok) return skipped('FBI Wanted indisponível');
    const items = asList(asRecord(result.json).items);
    const findings = items.slice(0, 5).flatMap((row) => {
      const item = asRecord(row);
      const title = String(item.title ?? '');
      if (!title) return [];
      return [
        {
          category: 'MANDADO' as const,
          title,
          summary: String(item.description ?? item.reward_text ?? 'Registro na lista FBI Wanted'),
          details: item,
          confidence: 60,
          url: String(item.url ?? 'https://www.fbi.gov/wanted'),
        },
      ];
    });
    if (!findings.length) return skipped('Nenhum aviso FBI para este nome');
    return ok(findings, { total: asRecord(result.json).total });
  },
};
