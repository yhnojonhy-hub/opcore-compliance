import { createHash } from 'node:crypto';
import type { DocumentType } from '@prisma/client';
import { consultDocument } from '../compliance/compliance.service.js';

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
  kind: 'update' | 'decision' | 'petition';
  content: string;
}

export interface LawsuitSearchParty {
  name: string | null;
  document: string | null;
  type: string | null;
  polarity: string | null;
}

export interface LawsuitSearchSource {
  document: string;
  documentType: DocumentType;
  status: 'ok' | 'not_found' | 'error';
  detail?: string;
}

export interface LawsuitSearchResult {
  number: string;
  found: boolean;
  court: string | null;
  courtLevel: string | null;
  district: string | null;
  state: string | null;
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
  const items: Omit<LawsuitSearchMovement, 'id'>[] = [
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
  ].filter((m): m is Omit<LawsuitSearchMovement, 'id'> => m.date != null && m.content != null);
  return items.map((m) => ({ ...m, id: movementId(number, m.date, m.content) }));
}

function emptyResult(number: string, sources: LawsuitSearchSource[]): LawsuitSearchResult {
  return {
    number,
    found: false,
    court: null,
    courtLevel: null,
    district: null,
    state: null,
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

/** Merge every occurrence of the lawsuit (one per party document), preferring the freshest row. */
export function mergeLawsuitRows(
  number: string,
  rows: RawRecord[],
  sources: LawsuitSearchSource[],
): LawsuitSearchResult {
  if (rows.length === 0) return emptyResult(number, sources);
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
    court: pick('CourtName'),
    courtLevel: pick('CourtLevel'),
    district: pick('CourtDistrict'),
    state: pick('State'),
    judgingBody: pick('JudgingBody'),
    judge: pick('Judge'),
    type: pick('Type') ?? pick('InferredCNJProcedureTypeName'),
    subject: pick('MainSubject') ?? pick('InferredCNJSubjectName'),
    status: pick('Status'),
    amount,
    noticeDate: pickDate('NoticeDate'),
    lastMovementDate: pickDate('LastMovementDate'),
    closeDate: pickDate('CloseDate'),
    parties: [...parties.values()],
    movements: [...movements.values()].sort((a, b) => b.date.localeCompare(a.date)),
    sources,
  };
}

/**
 * Finds a lawsuit by number among the lawsuits of its parties' CPF/CNPJ (BigDataCorp processes
 * datasets only, reusing the consultation cache).
 */
export async function searchLawsuit(
  input: { number: string; documents: LawsuitSearchDocument[]; requestedBy?: string },
  deps: LawsuitSearchDeps = {},
): Promise<LawsuitSearchResult> {
  const number = lawsuitDigits(input.number);
  if (number.length !== 20) {
    throw new InvalidLawsuitNumberError(
      'Número de processo inválido (esperado CNJ com 20 dígitos)',
    );
  }
  const consult = deps.consult ?? consultDocument;
  const documents = [
    ...new Map(input.documents.map((d) => [`${d.documentType}:${d.document}`, d])).values(),
  ];

  const outcomes = await Promise.all(
    documents.map(async (doc) => {
      const label = maskDocument(doc.document, doc.documentType);
      try {
        const result = await consult({
          document: doc.document,
          documentType: doc.documentType,
          providerSlug: LAWSUIT_PROVIDER_BY_TYPE[doc.documentType],
          requestedBy: input.requestedBy,
          includeRaw: true,
        });
        const lawsuits = extractLawsuits(result.rawPayload);
        const matches = lawsuits.filter((l) => lawsuitDigits(String(l.Number ?? '')) === number);
        const source: LawsuitSearchSource =
          matches.length > 0
            ? { document: label, documentType: doc.documentType, status: 'ok' }
            : {
                document: label,
                documentType: doc.documentType,
                status: 'not_found',
                detail: `${lawsuits.length} processo(s) do documento, nenhum com este número`,
              };
        return { matches, source };
      } catch (e) {
        return {
          matches: [] as RawRecord[],
          source: {
            document: label,
            documentType: doc.documentType,
            status: 'error' as const,
            detail: (e as Error).message,
          },
        };
      }
    }),
  );

  return mergeLawsuitRows(
    number,
    outcomes.flatMap((o) => o.matches),
    outcomes.map((o) => o.source),
  );
}
