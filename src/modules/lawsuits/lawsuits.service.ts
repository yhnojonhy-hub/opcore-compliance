import { createHash } from 'node:crypto';
import type { DocumentType } from '@prisma/client';
import { consultDocument } from '../compliance/compliance.service.js';
import {
  searchDataJudByNumber,
  type DataJudByNumberResult,
  type DataJudLawsuit,
} from './datajud-by-number.js';

export const LAWSUIT_PROVIDER_BY_TYPE: Record<DocumentType, string> = {
  CPF: 'bigdatacorp-pf-processes',
  CNPJ: 'bigdatacorp-pj-processes',
};

export class InvalidLawsuitNumberError extends Error {}

export interface LawsuitSearchDocument {
  document: string;
  documentType: DocumentType;
}

export interface LawsuitSearchMovement {
  id: string;
  date: string;
  kind: 'update' | 'decision' | 'petition' | 'court_movement';
  source: 'BigDataCorp' | 'DataJud CNJ';
  content: string;
}

export interface LawsuitSearchParty {
  name: string | null;
  document: string | null;
  type: string | null;
  polarity: string | null;
}

export interface LawsuitSearchSource {
  name: string;
  status: 'ok' | 'not_found' | 'error' | 'skipped';
  detail?: string;
}

export interface LawsuitSearchResult {
  number: string;
  found: boolean;
  court: string | null;
  courtLevel: string | null;
  district: string | null;
  state: string | null;
  cityIbgeCode: string | null;
  judgingBody: string | null;
  judge: string | null;
  type: string | null;
  subject: string | null;
  status: string | null;
  amount: number | null;
  noticeDate: string | null;
  lastMovementDate: string | null;
  closeDate: string | null;
  parties: LawsuitSearchParty[];
  movements: LawsuitSearchMovement[];
  sources: LawsuitSearchSource[];
}

type Consult = typeof consultDocument;

export interface LawsuitSearchDeps {
  consult?: Consult;
  dataJud?: (digits: string) => Promise<DataJudByNumberResult>;
}

type RawRecord = Record<string, unknown>;

export function lawsuitDigits(value: string): string {
  return value.replace(/\D/g, '');
}

function asRecord(value: unknown): RawRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as RawRecord) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** BigDataCorp uses `0001-01-01` for unknown dates. */
function date(value: unknown): string | null {
  const s = str(value);
  if (!s || s.startsWith('0001-01-01')) return null;
  return s;
}

export function maskDocument(document: string, documentType: DocumentType): string {
  return documentType === 'CPF'
    ? `***.${document.slice(3, 6)}.***-**`
    : `${document.slice(0, 8)}/****`;
}

/** Lawsuit rows from a BigDataCorp `processes` response (`Lawsuits` or `Processes` wrapper). */
export function extractLawsuits(raw: unknown): RawRecord[] {
  return asArray(asRecord(raw).Result).flatMap((result) => {
    const record = asRecord(result);
    return [record.Lawsuits, record.Processes].flatMap((wrapper) =>
      asArray(asRecord(wrapper).Lawsuits).map(asRecord),
    );
  });
}

function movementId(number: string, when: string, content: string): string {
  return createHash('sha1').update(`${number}|${when}|${content}`).digest('hex').slice(0, 24);
}

function movementsOf(number: string, lawsuit: RawRecord): LawsuitSearchMovement[] {
  type BureauMovement = { kind: 'update' | 'decision' | 'petition'; date: string; content: string };
  const items = [
    ...asArray(lawsuit.Updates).map((u) => ({
      kind: 'update' as const,
      date: date(asRecord(u).PublishDate) ?? date(asRecord(u).CaptureDate),
      content: str(asRecord(u).Content),
    })),
    ...asArray(lawsuit.Decisions).map((d) => ({
      kind: 'decision' as const,
      date: date(asRecord(d).DecisionDate),
      content: str(asRecord(d).DecisionContent),
    })),
    ...asArray(lawsuit.Petitions).map((p) => {
      const type = str(asRecord(p).Type);
      return {
        kind: 'petition' as const,
        date: date(asRecord(p).CreationDate) ?? date(asRecord(p).JoinedDate),
        content: type ? `PETIÇÃO: ${type}` : null,
      };
    }),
  ].filter((m): m is BureauMovement => m.date != null && m.content != null);
  return items.map((m) => ({
    ...m,
    source: 'BigDataCorp' as const,
    id: movementId(number, m.date, m.content),
  }));
}

function emptyResult(number: string, sources: LawsuitSearchSource[]): LawsuitSearchResult {
  return {
    number,
    found: false,
    court: null,
    courtLevel: null,
    district: null,
    state: null,
    cityIbgeCode: null,
    judgingBody: null,
    judge: null,
    type: null,
    subject: null,
    status: null,
    amount: null,
    noticeDate: null,
    lastMovementDate: null,
    closeDate: null,
    parties: [],
    movements: [],
    sources,
  };
}

const STATE_BY_ALIAS: Record<string, string> = { tjdft: 'DF' };

function stateFromAlias(alias: string): string | null {
  if (STATE_BY_ALIAS[alias]) return STATE_BY_ALIAS[alias];
  const match = /^tj([a-z]{2})$/.exec(alias);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Merge the BigDataCorp occurrences of the lawsuit (one per party document, freshest first) with
 * the DataJud record. BigDataCorp wins on descriptive fields; DataJud fills gaps and adds the
 * recent court movements BigDataCorp has not captured yet.
 */
export function mergeLawsuitSources(
  number: string,
  rows: RawRecord[],
  dataJud: DataJudLawsuit | null,
  sources: LawsuitSearchSource[],
): LawsuitSearchResult {
  if (rows.length === 0 && !dataJud) return emptyResult(number, sources);
  const sorted = [...rows].sort((a, b) =>
    (date(b.LastUpdate) ?? date(b.LastMovementDate) ?? '').localeCompare(
      date(a.LastUpdate) ?? date(a.LastMovementDate) ?? '',
    ),
  );
  const pick = (key: string) => sorted.map((r) => str(r[key])).find((v) => v != null) ?? null;
  const pickDate = (key: string) => sorted.map((r) => date(r[key])).find((v) => v != null) ?? null;
  const amount =
    sorted.map((r) => r.Value).find((v): v is number => typeof v === 'number' && v >= 0) ?? null;

  const movements = new Map<string, LawsuitSearchMovement>();
  for (const row of sorted) for (const m of movementsOf(number, row)) movements.set(m.id, m);
  for (const m of dataJud?.movements ?? []) {
    movements.set(m.id, { ...m, kind: 'court_movement', source: 'DataJud CNJ' });
  }
  const ordered = [...movements.values()].sort((a, b) => b.date.localeCompare(a.date));

  const parties = new Map<string, LawsuitSearchParty>();
  for (const row of sorted) {
    for (const p of asArray(row.Parties).map(asRecord)) {
      const party: LawsuitSearchParty = {
        name: str(p.Name),
        document: str(p.Doc),
        type: str(asRecord(p.PartyDetails).SpecificType) ?? str(p.Type),
        polarity: str(p.Polarity),
      };
      const key = `${party.document ?? party.name}|${party.type}`;
      if (!parties.has(key)) parties.set(key, party);
    }
  }

  return {
    number,
    found: true,
    court: pick('CourtName') ?? dataJud?.tribunal ?? null,
    courtLevel: pick('CourtLevel') ?? dataJud?.degree ?? null,
    district: pick('CourtDistrict'),
    state: pick('State') ?? (dataJud ? stateFromAlias(dataJud.alias) : null),
    cityIbgeCode: dataJud?.cityIbgeCode ?? null,
    judgingBody: pick('JudgingBody') ?? dataJud?.judgingBody ?? null,
    judge: pick('Judge'),
    type: pick('Type') ?? pick('InferredCNJProcedureTypeName') ?? dataJud?.className ?? null,
    subject: pick('MainSubject') ?? pick('InferredCNJSubjectName') ?? dataJud?.subject ?? null,
    status: pick('Status'),
    amount,
    noticeDate: pickDate('NoticeDate') ?? dataJud?.filedAt ?? null,
    lastMovementDate: ordered[0]?.date ?? pickDate('LastMovementDate'),
    closeDate: pickDate('CloseDate'),
    parties: [...parties.values()],
    movements: ordered,
    sources,
  };
}

async function searchBureau(
  number: string,
  doc: LawsuitSearchDocument,
  consult: Consult,
  input: { requestedBy?: string; forceRefresh?: boolean },
): Promise<{ matches: RawRecord[]; source: LawsuitSearchSource }> {
  const name = `BigDataCorp (${doc.documentType} ${maskDocument(doc.document, doc.documentType)})`;
  try {
    const result = await consult({
      document: doc.document,
      documentType: doc.documentType,
      providerSlug: LAWSUIT_PROVIDER_BY_TYPE[doc.documentType],
      requestedBy: input.requestedBy,
      includeRaw: true,
      forceRefresh: input.forceRefresh,
    });
    const lawsuits = extractLawsuits(result.rawPayload);
    const matches = lawsuits.filter((l) => lawsuitDigits(String(l.Number ?? '')) === number);
    return matches.length > 0
      ? { matches, source: { name, status: 'ok' } }
      : {
          matches,
          source: {
            name,
            status: 'not_found',
            detail: `${lawsuits.length} processo(s) do documento, nenhum com este número`,
          },
        };
  } catch (e) {
    return { matches: [], source: { name, status: 'error', detail: (e as Error).message } };
  }
}

/**
 * Finds a lawsuit by number across every OpCore source: the BigDataCorp processes dataset of
 * each party CPF/CNPJ and the DataJud index of the court in the number.
 */
export async function searchLawsuit(
  input: {
    number: string;
    documents: LawsuitSearchDocument[];
    requestedBy?: string;
    forceRefresh?: boolean;
  },
  deps: LawsuitSearchDeps = {},
): Promise<LawsuitSearchResult> {
  const number = lawsuitDigits(input.number);
  if (number.length !== 20) {
    throw new InvalidLawsuitNumberError(
      'Número de processo inválido (esperado CNJ com 20 dígitos)',
    );
  }
  const consult = deps.consult ?? consultDocument;
  const dataJudSearch = deps.dataJud ?? ((digits: string) => searchDataJudByNumber(digits));
  const documents = [
    ...new Map(input.documents.map((d) => [`${d.documentType}:${d.document}`, d])).values(),
  ];

  const [bureaus, dataJud] = await Promise.all([
    Promise.all(documents.map((doc) => searchBureau(number, doc, consult, input))),
    dataJudSearch(number).catch((e): DataJudByNumberResult => ({
      status: 'error',
      alias: null,
      detail: (e as Error).message,
    })),
  ]);

  const dataJudSource: LawsuitSearchSource =
    dataJud.status === 'ok'
      ? {
          name: `DataJud CNJ (${dataJud.lawsuit.alias.toUpperCase()})`,
          status: 'ok',
          detail: `${dataJud.lawsuit.movements.length} movimento(s)`,
        }
      : {
          name: `DataJud CNJ${dataJud.alias ? ` (${dataJud.alias.toUpperCase()})` : ''}`,
          status: dataJud.status,
          detail: dataJud.detail,
        };

  return mergeLawsuitSources(
    number,
    bureaus.flatMap((b) => b.matches),
    dataJud.status === 'ok' ? dataJud.lawsuit : null,
    [...bureaus.map((b) => b.source), dataJudSource],
  );
}
