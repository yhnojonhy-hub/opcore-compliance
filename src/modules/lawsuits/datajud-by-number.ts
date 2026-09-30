import { createHash } from 'node:crypto';
import { getEnv } from '../../lib/intel-env.js';
import {
  CNJ_JTR_TO_ALIAS,
  DATAJUD_SEARCH_URL,
} from '../../providers/adapters/datajud/endpoints.js';
import { fetchJson } from '../../providers/adapters/http.util.js';

export interface DataJudMovement {
  id: string;
  date: string;
  content: string;
}

export interface DataJudLawsuit {
  alias: string;
  tribunal: string | null;
  className: string | null;
  judgingBody: string | null;
  cityIbgeCode: string | null;
  degree: string | null;
  subject: string | null;
  filedAt: string | null;
  movements: DataJudMovement[];
}

export type DataJudByNumberResult =
  | { status: 'ok'; lawsuit: DataJudLawsuit }
  | { status: 'not_found' | 'skipped' | 'error'; alias: string | null; detail: string };

export interface DataJudByNumberDeps {
  fetchJson?: typeof fetchJson;
  sleep?: (ms: number) => Promise<void>;
  apiKey?: string;
}

/** DataJud often answers in 15-25s from our server; one retry on throttling or timeout. */
const ATTEMPT_TIMEOUT_MS = 25_000;
const RETRY_DELAY_MS = 2_000;

type RawRecord = Record<string, unknown>;

function asRecord(value: unknown): RawRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as RawRecord) : {};
}

function str(value: unknown): string | null {
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** CNJ number NNNNNNN-DD.AAAA.J.TR.OOOO: segment J and court TR pick the DataJud index. */
export function dataJudAliasForNumber(digits: string): string | null {
  if (digits.length !== 20) return null;
  const segment = digits[13];
  const tr = digits.slice(14, 16);
  const alias =
    segment === '8'
      ? CNJ_JTR_TO_ALIAS[`8${tr}`]
      : segment === '4'
        ? `trf${Number(tr)}`
        : segment === '5'
          ? `trt${Number(tr)}`
          : undefined;
  return alias && DATAJUD_SEARCH_URL[alias] ? alias : null;
}

function isoDate(value: unknown): string | null {
  const s = str(value);
  if (!s) return null;
  if (/^\d{14}$/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}Z`;
  }
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function movementContent(mov: RawRecord): string | null {
  const name = str(mov.nome);
  if (!name) return null;
  const complements = (Array.isArray(mov.complementosTabelados) ? mov.complementosTabelados : [])
    .map((c) => {
      const item = asRecord(c);
      return str(item.nome) ?? str(item.descricao);
    })
    .filter((c): c is string => c != null);
  return complements.length > 0 ? `${name} - ${complements.join('; ')}` : name;
}

export function parseDataJudHits(alias: string, digits: string, hits: unknown[]): DataJudLawsuit {
  const sources = hits.map((h) => asRecord(asRecord(h)._source));
  const sorted = [...sources].sort((a, b) =>
    (str(b.dataHoraUltimaAtualizacao) ?? '').localeCompare(str(a.dataHoraUltimaAtualizacao) ?? ''),
  );
  const first = sorted[0] ?? {};
  const organ = asRecord(first.orgaoJulgador);
  const subjects = (Array.isArray(first.assuntos) ? first.assuntos : [])
    .flatMap((a) => (Array.isArray(a) ? a : [a]))
    .map((a) => str(asRecord(a).nome))
    .filter((a): a is string => a != null);

  const movements = new Map<string, DataJudMovement>();
  for (const source of sorted) {
    for (const raw of Array.isArray(source.movimentos) ? source.movimentos : []) {
      const mov = asRecord(raw);
      const date = isoDate(mov.dataHora);
      const content = movementContent(mov);
      if (!date || !content) continue;
      const id = createHash('sha1')
        .update(`${digits}|datajud|${date}|${str(mov.codigo) ?? ''}|${content}`)
        .digest('hex')
        .slice(0, 24);
      movements.set(id, { id, date, content });
    }
  }

  return {
    alias,
    tribunal: str(first.tribunal),
    className: str(asRecord(first.classe).nome),
    judgingBody: str(organ.nome),
    cityIbgeCode: str(organ.codigoMunicipioIBGE),
    degree: str(first.grau),
    subject: subjects[0] ?? null,
    filedAt: isoDate(first.dataAjuizamento),
    movements: [...movements.values()].sort((a, b) => b.date.localeCompare(a.date)),
  };
}

export async function searchDataJudByNumber(
  digits: string,
  deps: DataJudByNumberDeps = {},
): Promise<DataJudByNumberResult> {
  const alias = dataJudAliasForNumber(digits);
  if (!alias) {
    return { status: 'skipped', alias: null, detail: 'tribunal do número sem índice no DataJud' };
  }
  const apiKey = deps.apiKey ?? getEnv().DATAJUD_API_KEY;
  if (!apiKey) return { status: 'skipped', alias, detail: 'DataJud sem chave configurada' };

  const fetcher = deps.fetchJson ?? fetchJson;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `APIKey ${apiKey}` },
    body: JSON.stringify({ size: 10, query: { match: { numeroProcesso: digits } } }),
  };

  let response = await fetcher(DATAJUD_SEARCH_URL[alias], init, ATTEMPT_TIMEOUT_MS);
  if (response.status === 429 || response.status === 0 || response.status >= 500) {
    await sleep(RETRY_DELAY_MS);
    response = await fetcher(DATAJUD_SEARCH_URL[alias], init, ATTEMPT_TIMEOUT_MS);
  }
  if (!response.ok) {
    const detail =
      response.status === 429
        ? 'limite de consultas do DataJud atingido (429)'
        : response.status === 0
          ? 'DataJud não respondeu (timeout ou rede)'
          : `DataJud respondeu ${response.status}`;
    return { status: 'error', alias, detail };
  }
  const hits = asRecord(asRecord(response.json).hits).hits;
  const list = Array.isArray(hits) ? hits : [];
  if (list.length === 0) {
    return { status: 'not_found', alias, detail: `não encontrado em ${alias.toUpperCase()}` };
  }
  return { status: 'ok', lawsuit: parseDataJudHits(alias, digits, list) };
}
