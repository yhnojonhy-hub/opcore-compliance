import { getEnv } from '../../../lib/intel-env.js';
import type { CnjNumber } from '../../../lib/cnj.js';
import { dataJudAliasesForCnj } from '../../../lib/cnj.js';
import type { LawsuitMovement } from '../../../contracts/types/canonical/lawsuit-detail.types.js';
import { DATAJUD_SEARCH_URL } from './endpoints.js';
import { fetchJson } from '../http.util.js';

interface DataJudComplement {
  codigo?: number;
  descricao?: string;
  nome?: string;
  valor?: string | number;
}

interface DataJudSource {
  numeroProcesso?: string;
  tribunal?: string;
  grau?: string;
  dataAjuizamento?: string;
  dataHoraUltimaAtualizacao?: string;
  nivelSigilo?: number;
  classe?: { codigo?: number; nome?: string };
  assuntos?: Array<{ codigo?: number; nome?: string } | Array<{ codigo?: number; nome?: string }>>;
  orgaoJulgador?: { codigo?: number; nome?: string; codigoMunicipioIBGE?: number };
  formato?: { nome?: string };
  sistema?: { nome?: string };
  movimentos?: Array<{
    codigo?: number;
    nome?: string;
    dataHora?: string;
    complementosTabelados?: DataJudComplement[];
  }>;
}

interface DataJudHit {
  _id?: string;
  _source?: DataJudSource;
}

export interface DataJudInstance {
  alias: string;
  degree: string | null;
  organ: string | null;
  className: string | null;
  subjects: string[];
  filedAt: string | null;
  updatedAt: string | null;
  system: string | null;
}

export type DataJudByNumberResult =
  | {
      status: 'ok';
      alias: string;
      tribunal: string | null;
      instances: DataJudInstance[];
      movements: LawsuitMovement[];
    }
  | { status: 'not_found'; triedAliases: string[] }
  | { status: 'skipped'; error: string }
  | { status: 'error'; error: string; httpStatus?: number };

export interface DataJudByNumberDeps {
  fetchJson?: typeof fetchJson;
  sleep?: (ms: number) => Promise<void>;
}

const RETRY_DELAYS_MS = [1_500, 4_000];
/** DataJud sometimes hangs; a hung attempt is retried instead of waiting the full env timeout. */
const ATTEMPT_TIMEOUT_MS = 30_000;

function toDate(value?: string): string | null {
  if (!value) return null;
  if (/^\d{14}$/.test(value)) {
    const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}Z`;
    return iso;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function subjectNames(source: DataJudSource): string[] {
  const names = (source.assuntos ?? [])
    .flatMap((item) => (Array.isArray(item) ? item : [item]))
    .map((item) => item?.nome?.trim())
    .filter((name): name is string => Boolean(name));
  return [...new Set(names)];
}

function parseHits(alias: string, hits: DataJudHit[]) {
  const instances: DataJudInstance[] = [];
  const byKey = new Map<string, LawsuitMovement>();

  for (const hit of hits) {
    const source = hit._source ?? {};
    const degree = source.grau ?? null;
    instances.push({
      alias,
      degree,
      organ: source.orgaoJulgador?.nome?.trim() || null,
      className: source.classe?.nome?.trim() || null,
      subjects: subjectNames(source),
      filedAt: toDate(source.dataAjuizamento),
      updatedAt: toDate(source.dataHoraUltimaAtualizacao),
      system: source.sistema?.nome?.trim() || null,
    });

    for (const mov of source.movimentos ?? []) {
      const date = toDate(mov.dataHora);
      if (!date) continue;
      const code = mov.codigo ?? 0;
      const key = `${code}-${date}`;
      if (byKey.has(key)) continue;
      byKey.set(key, {
        id: `${hit._id ?? alias}-${code}-${mov.dataHora}`,
        date,
        code,
        name: mov.nome?.trim() || `Movimentação ${code}`,
        degree,
        complements: (mov.complementosTabelados ?? []).map((c) => ({
          code: c.codigo ?? null,
          name: c.nome ?? null,
          description: c.descricao ?? null,
          value: c.valor != null ? String(c.valor) : null,
        })),
        source: 'DataJud CNJ',
      });
    }
  }

  const movements = [...byKey.values()].sort((a, b) => b.date.localeCompare(a.date));
  return { instances, movements, tribunal: hits[0]?._source?.tribunal ?? null };
}

async function queryAlias(
  alias: string,
  digits: string,
  apiKey: string,
  timeoutMs: number,
  deps: Required<DataJudByNumberDeps>,
) {
  const url = DATAJUD_SEARCH_URL[alias];
  if (!url) return { ok: false as const, status: 404, hits: [] as DataJudHit[] };
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `APIKey ${apiKey}` },
    body: JSON.stringify({ size: 10, query: { match: { numeroProcesso: digits } } }),
  };

  let response = await deps.fetchJson(url, init, timeoutMs);
  for (const delay of RETRY_DELAYS_MS) {
    if (response.status !== 429 && response.status !== 0 && response.status < 500) break;
    await deps.sleep(delay);
    response = await deps.fetchJson(url, init, timeoutMs);
  }
  if (!response.ok) return { ok: false as const, status: response.status, hits: [] };
  const hits = (response.json as { hits?: { hits?: DataJudHit[] } } | null)?.hits?.hits ?? [];
  return { ok: true as const, status: response.status, hits };
}

export async function searchDataJudByNumber(
  cnj: CnjNumber,
  deps: DataJudByNumberDeps = {},
): Promise<DataJudByNumberResult> {
  const env = getEnv();
  if (!env.DATAJUD_API_KEY) return { status: 'skipped', error: 'DATAJUD_API_KEY não configurada' };

  const resolved: Required<DataJudByNumberDeps> = {
    fetchJson: deps.fetchJson ?? fetchJson,
    sleep: deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
  };
  const aliases = dataJudAliasesForCnj(cnj);
  if (aliases.length === 0) {
    return { status: 'skipped', error: `Tribunal do código CNJ ${cnj.jtr} sem endpoint DataJud` };
  }

  const timeoutMs = Math.min(Math.max(env.DATAJUD_REQUEST_TIMEOUT_MS, 5_000), ATTEMPT_TIMEOUT_MS);
  let lastError: { status: number } | null = null;
  for (const alias of aliases) {
    const result = await queryAlias(alias, cnj.digits, env.DATAJUD_API_KEY, timeoutMs, resolved);
    if (!result.ok) {
      lastError = { status: result.status };
      continue;
    }
    if (result.hits.length === 0) continue;
    const parsed = parseHits(alias, result.hits);
    return { status: 'ok', alias, ...parsed };
  }

  if (lastError) {
    const reason =
      lastError.status === 429
        ? 'limite de consultas do DataJud atingido (429)'
        : lastError.status === 0
          ? 'DataJud não respondeu (timeout ou rede)'
          : `DataJud respondeu ${lastError.status}`;
    return { status: 'error', error: reason, httpStatus: lastError.status };
  }
  return { status: 'not_found', triedAliases: aliases };
}
