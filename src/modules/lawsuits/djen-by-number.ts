import { fetchJson } from '../../providers/adapters/http.util.js';

export const DJEN_COMMUNICATIONS_URL = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao';

export interface DjenCommunication {
  id: string;
  /** Availability date in the DJEN (YYYY-MM-DD); publication is the next business day. */
  availableAt: string;
  type: string | null;
  documentType: string | null;
  court: string | null;
  organ: string | null;
  recipients: string[];
  text: string;
  link: string | null;
}

export type DjenByNumberResult =
  | { status: 'ok'; communications: DjenCommunication[] }
  | { status: 'not_found' | 'error'; detail: string };

export interface DjenByNumberDeps {
  fetchJson?: typeof fetchJson;
  sleep?: (ms: number) => Promise<void>;
}

/** The API caps itensPorPagina at 50 and only answers Brazilian IPs. */
const PAGE_SIZE = 50;
const MAX_PAGES = 4;
const ATTEMPT_TIMEOUT_MS = 20_000;
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

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  ordm: 'º',
  ordf: 'ª',
  sect: '§',
  deg: '°',
  ndash: '–',
  mdash: '—',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  hellip: '…',
};

const COMBINING_MARK: Record<string, string> = {
  acute: '\u0301',
  grave: '\u0300',
  circ: '\u0302',
  tilde: '\u0303',
  uml: '\u0308',
  cedil: '\u0327',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name.startsWith('#x') || name.startsWith('#X')) {
      return String.fromCodePoint(parseInt(name.slice(2), 16));
    }
    if (name.startsWith('#')) return String.fromCodePoint(Number(name.slice(1)));
    if (NAMED_ENTITIES[name]) return NAMED_ENTITIES[name];
    const accented = /^([a-z])(acute|grave|circ|tilde|uml|cedil)$/i.exec(name);
    return accented ? `${accented[1]}${COMBINING_MARK[accented[2]]}`.normalize('NFC') : entity;
  });
}

/** DJEN `texto` is a full HTML document; keep paragraphs as lines. */
export function djenHtmlToText(html: string): string {
  const withBreaks = html
    .replace(/<(head|style|script)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|section|tr|div|header|footer|h\d)>/gi, '\n')
    .replace(/<\/td>/gi, ' ')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(withBreaks)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

const POLO_LABEL: Record<string, string> = { A: 'polo ativo', P: 'polo passivo' };

function recipientsOf(item: RawRecord): string[] {
  const parties = (Array.isArray(item.destinatarios) ? item.destinatarios : [])
    .map((d) => {
      const record = asRecord(d);
      const name = str(record.nome);
      const polo = POLO_LABEL[str(record.polo) ?? ''];
      return name ? (polo ? `${name} (${polo})` : name) : null;
    })
    .filter((r): r is string => r != null);
  const lawyers = (Array.isArray(item.destinatarioadvogados) ? item.destinatarioadvogados : [])
    .map((d) => {
      const lawyer = asRecord(asRecord(d).advogado);
      const name = str(lawyer.nome);
      const oab = str(lawyer.numero_oab);
      return name ? `Adv. ${name}${oab ? ` (OAB ${str(lawyer.uf_oab) ?? ''}${oab})` : ''}` : null;
    })
    .filter((r): r is string => r != null);
  return [...new Set([...parties, ...lawyers])];
}

export function parseDjenItems(items: unknown[]): DjenCommunication[] {
  const byId = new Map<string, DjenCommunication>();
  for (const raw of items) {
    const item = asRecord(raw);
    if (item.ativo === false || str(item.data_cancelamento)) continue;
    const id = str(item.hash) ?? str(item.id);
    const availableAt = str(item.data_disponibilizacao);
    const html = str(item.texto);
    if (!id || !availableAt || !/^\d{4}-\d{2}-\d{2}$/.test(availableAt) || !html) continue;
    const text = djenHtmlToText(html);
    if (!text) continue;
    byId.set(id, {
      id,
      availableAt,
      type: str(item.tipoComunicacao),
      documentType: str(item.tipoDocumento),
      court: str(item.siglaTribunal),
      organ: str(item.nomeOrgao),
      recipients: recipientsOf(item),
      text,
      link: str(item.link),
    });
  }
  return [...byId.values()].sort((a, b) => b.availableAt.localeCompare(a.availableAt));
}

function errorDetail(status: number): string {
  if (status === 403) return 'DJEN bloqueou o IP (acesso só do Brasil)';
  if (status === 429) return 'limite de consultas do DJEN atingido (429)';
  if (status === 0) return 'DJEN não respondeu (timeout ou rede)';
  return `DJEN respondeu ${status}`;
}

/** Intimations and other communications published in the DJEN for a CNJ number. */
export async function searchDjenByNumber(
  digits: string,
  deps: DjenByNumberDeps = {},
): Promise<DjenByNumberResult> {
  const fetcher = deps.fetchJson ?? fetchJson;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const items: unknown[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${DJEN_COMMUNICATIONS_URL}?numeroProcesso=${digits}&itensPorPagina=${PAGE_SIZE}&pagina=${page}`;
    let response = await fetcher(url, {}, ATTEMPT_TIMEOUT_MS);
    if (response.status === 429 || response.status === 0 || response.status >= 500) {
      await sleep(RETRY_DELAY_MS);
      response = await fetcher(url, {}, ATTEMPT_TIMEOUT_MS);
    }
    if (!response.ok) {
      if (page === 1) return { status: 'error', detail: errorDetail(response.status) };
      break;
    }
    const body = asRecord(response.json);
    const pageItems = Array.isArray(body.items) ? body.items : [];
    items.push(...pageItems);
    const count = typeof body.count === 'number' ? body.count : items.length;
    if (pageItems.length < PAGE_SIZE || items.length >= count) break;
  }

  const communications = parseDjenItems(items);
  return communications.length > 0
    ? { status: 'ok', communications }
    : { status: 'not_found', detail: 'nenhuma comunicação no DJEN' };
}
