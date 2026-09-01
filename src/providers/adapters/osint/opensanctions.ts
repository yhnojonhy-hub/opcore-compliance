import { getEnv } from '../../../lib/intel-env.js';
import { digitsOnly, isValidCnpj, isValidCpf } from '../../../contracts/utils/document.util.js';
import { asRecord, fetchJson } from '../http.util.js';
import type { DossierProvider, ProviderContext, ProviderFinding } from '../types.js';

const CSV_URL = 'https://data.opensanctions.org/datasets/latest/sanctions/targets.simple.csv';
const CACHE_MS = 12 * 60 * 60 * 1000;

type SanctionRow = {
  id: string;
  caption: string;
  name: string;
  aliases: string;
  identifiers: string;
  countries: string;
  dataset: string;
  schema: string;
};

let csvCache: { at: number; rows: SanctionRow[] } | null = null;

function skipped(reason: string) {
  return { status: 'skipped' as const, error: reason, findings: [] };
}

function ok(findings: ProviderFinding[], rawPayload?: unknown, httpStatus = 200) {
  return { status: 'ok' as const, httpStatus, rawPayload, findings };
}

export function resetOpenSanctionsCache(): void {
  csvCache = null;
}

export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      out.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  out.push(current);
  return out;
}

export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function significantTokens(value: string): string[] {
  return normalizeText(value)
    .split(' ')
    .filter((token) => token.length > 2);
}

export function nameMatches(query: string, haystack: string): boolean {
  const tokens = significantTokens(query);
  if (tokens.length === 0) return false;
  const hay = normalizeText(haystack);
  if (!hay) return false;
  if (tokens.length === 1) return tokens[0].length >= 6 && hay.includes(tokens[0]);
  return tokens.every((token) => hay.includes(token));
}

export function identifierMatches(queryDigits: string, identifiers: string): boolean {
  if (queryDigits.length < 11) return false;
  return identifiers.replace(/\D/g, '').includes(queryDigits);
}

export function parseSimpleCsv(text: string): SanctionRow[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]).map((item) => item.trim().toLowerCase());
  const indexOf = (names: string[]) =>
    names.map((name) => header.indexOf(name)).find((index) => index >= 0) ?? -1;
  const idIdx = indexOf(['id']);
  const captionIdx = indexOf(['caption', 'name']);
  const nameIdx = indexOf(['name']);
  const aliasesIdx = indexOf(['aliases']);
  const identifiersIdx = indexOf(['identifiers']);
  const countriesIdx = indexOf(['countries']);
  const datasetIdx = indexOf(['dataset']);
  const schemaIdx = indexOf(['schema']);
  const cell = (cols: string[], index: number) => (index >= 0 ? (cols[index] ?? '').trim() : '');

  return lines.slice(1).flatMap((line) => {
    const cols = splitCsvLine(line);
    const id = cell(cols, idIdx);
    const caption = cell(cols, captionIdx) || cell(cols, nameIdx);
    if (!id && !caption) return [];
    return [
      {
        id,
        caption,
        name: cell(cols, nameIdx) || caption,
        aliases: cell(cols, aliasesIdx),
        identifiers: cell(cols, identifiersIdx),
        countries: cell(cols, countriesIdx),
        dataset: cell(cols, datasetIdx),
        schema: cell(cols, schemaIdx),
      },
    ];
  });
}

export function matchSanctionRows(
  rows: SanctionRow[],
  query: { name?: string; document?: string },
  limit = 8,
): SanctionRow[] {
  const hits: SanctionRow[] = [];
  for (const row of rows) {
    const haystack = `${row.caption} ${row.name} ${row.aliases}`;
    const byName = query.name ? nameMatches(query.name, haystack) : false;
    const byId = query.document ? identifierMatches(query.document, row.identifiers) : false;
    if (!byName && !byId) continue;
    hits.push(row);
    if (hits.length >= limit) break;
  }
  return hits;
}

function queriesOf(ctx: ProviderContext): { names: string[]; document: string | null } {
  const names = [ctx.partyName, ctx.targetType === 'NAME' ? ctx.target : '', ...(ctx.aliases ?? [])]
    .map((item) => item?.trim() ?? '')
    .filter((item) => item.length > 3 && /[A-Za-zÀ-ÿ]/.test(item));
  let document: string | null = null;
  if (ctx.targetType === 'CNPJ') {
    const value = ctx.target.replace(/[./\s-]/g, '').toUpperCase();
    document = isValidCnpj(value) ? value : null;
  } else if (ctx.targetType === 'CPF') {
    const value = digitsOnly(ctx.target);
    document = isValidCpf(value) ? value : null;
  }
  return { names: [...new Set(names)].slice(0, 4), document };
}

function findingFromRow(row: SanctionRow, via: string): ProviderFinding {
  return {
    category: 'SANCTION',
    title: row.caption || row.name || row.id,
    summary: [row.schema, row.dataset, row.countries, via].filter(Boolean).join(' · '),
    details: row,
    confidence: 86,
    url: row.id
      ? `https://www.opensanctions.org/entities/${row.id}`
      : 'https://www.opensanctions.org',
  };
}

function findingFromApi(row: unknown): ProviderFinding | null {
  const item = asRecord(row);
  const caption = String(item.caption ?? item.id ?? '').trim();
  if (!caption) return null;
  const datasets = Array.isArray(item.datasets)
    ? item.datasets.map(String).slice(0, 4).join(', ')
    : '';
  const id = String(item.id ?? '');
  return {
    category: 'SANCTION',
    title: caption,
    summary: [String(item.schema ?? ''), datasets, `score ${String(item.score ?? '-')}`]
      .filter(Boolean)
      .join(' · '),
    details: item,
    confidence: 90,
    url: id ? `https://www.opensanctions.org/entities/${id}` : 'https://www.opensanctions.org',
  };
}

async function searchApi(query: string, apiKey: string) {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) headers.Authorization = `ApiKey ${apiKey}`;
  return fetchJson(
    `https://api.opensanctions.org/search/default?q=${encodeURIComponent(query)}&limit=5`,
    { headers },
    10_000,
  );
}

async function loadCsvRows(): Promise<{ rows: SanctionRow[]; status: number } | null> {
  if (csvCache && Date.now() - csvCache.at < CACHE_MS) {
    return { rows: csvCache.rows, status: 200 };
  }
  const result = await fetchJson(CSV_URL, { headers: { Accept: 'text/csv, text/plain' } }, 25_000);
  if (!result.ok || result.text.length < 80) return null;
  const rows = parseSimpleCsv(result.text);
  if (rows.length === 0) return null;
  csvCache = { at: Date.now(), rows };
  return { rows, status: result.status };
}

export const openSanctions: DossierProvider = {
  name: 'OpenSanctions',
  category: 'SANCTION',
  reliability: 'OFFICIAL',
  accepts: ['NAME', 'CNPJ', 'CPF'],
  phase: 'async',
  rateMs: 800,
  async run(ctx) {
    const { names, document } = queriesOf(ctx);
    const queries = [...names, document].filter((item): item is string => Boolean(item));
    if (queries.length === 0) return skipped('OpenSanctions precisa de nome ou documento');

    const apiKey = getEnv().OPENSANCTIONS_API_KEY.trim();
    const apiFindings: ProviderFinding[] = [];
    const raw: unknown[] = [];

    for (const query of queries.slice(0, 3)) {
      const result = await searchApi(query, apiKey);
      raw.push({ via: 'api', query, status: result.status });
      if (result.status === 429) return { status: 'rate_limited', httpStatus: 429, findings: [] };
      if (result.status === 401 || result.status === 402) break;
      if (!result.ok) continue;
      const payload = asRecord(result.json);
      const rows = Array.isArray(payload.results) ? payload.results : [];
      for (const row of rows) {
        const finding = findingFromApi(row);
        if (finding) apiFindings.push(finding);
      }
    }

    if (apiFindings.length) return ok(apiFindings.slice(0, 8), raw);

    const csv = await loadCsvRows();
    if (!csv) {
      if (!apiKey) {
        return skipped(
          'OpenSanctions API exige chave; lista pública de sanções também não baixou. Configure OPENSANCTIONS_API_KEY ou tente de novo',
        );
      }
      return skipped('OpenSanctions sem resultado na API e lista pública indisponível');
    }

    const seen = new Set<string>();
    const findings: ProviderFinding[] = [];
    for (const name of names) {
      for (const row of matchSanctionRows(csv.rows, { name, document: document ?? undefined })) {
        if (seen.has(row.id || row.caption)) continue;
        seen.add(row.id || row.caption);
        findings.push(findingFromRow(row, 'lista sanctions'));
      }
    }
    if (document && names.length === 0) {
      for (const row of matchSanctionRows(csv.rows, { document })) {
        if (seen.has(row.id || row.caption)) continue;
        seen.add(row.id || row.caption);
        findings.push(findingFromRow(row, 'lista sanctions'));
      }
    }

    if (findings.length === 0) {
      return ok(
        [
          {
            category: 'SANCTION',
            title: 'Sem correspondência OpenSanctions',
            summary: 'Lista consolidada de sanções sem hit para o nome ou documento informado',
            details: { names, document, rows: csv.rows.length },
            confidence: 70,
            url: 'https://www.opensanctions.org',
          },
        ],
        { matches: 0, via: 'csv', catalogSize: csv.rows.length },
      );
    }

    return ok(findings.slice(0, 8), { api: raw, csvStatus: csv.status });
  },
};
