import type { Lawsuit } from '../../contracts/types/canonical/shared.types.js';
import { asList } from '../../contracts/utils/array.util.js';
import { asRecord, readNumber, readString } from './read.util.js';

export function normalizeLawsuitItem(raw: unknown, source?: string): Lawsuit {
  const record = asRecord(raw);
  const sourceRecord = asRecord(record._source);

  const merged = Object.keys(sourceRecord).length > 0 ? { ...record, ...sourceRecord } : record;

  return {
    court: readString(
      merged.tribunal,
      merged.court,
      merged.CourtName,
      merged.alias,
      merged.orgaoJulgador,
      merged.JudgingBody,
      merged.siglaTribunal,
    ),
    type: readString(
      merged.classe,
      merged.type,
      merged.Type,
      merged.tipo,
      merged.assunto,
      merged.MainSubject,
      merged.CourtType,
    ),
    status: readString(merged.status, merged.Status, merged.situacao, merged.situation),
    amount: readNumber(merged.valor, merged.amount, merged.Value),
    caseNumber: readString(
      record.caseNumber,
      merged.numeroProcesso,
      merged.processNumber,
      merged.numero,
      merged.number,
      merged.Number,
    ),
    filedAt: readString(
      merged.dataAjuizamento,
      merged.filedAt,
      merged.data,
      merged.NoticeDate,
      merged.PublicationDate,
      merged.LastMovementDate,
    ),
    source: source ?? readString(merged.source, merged.fonte),
  };
}

/** Accept a lawsuit array or BigDataCorp wrapper `{ Lawsuits: [...] }`. */
export function coerceLawsuitRows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    const record = asRecord(value);
    if (Array.isArray(record.Lawsuits)) return record.Lawsuits;
    if (Array.isArray(record.lawsuits)) return record.lawsuits;
    if (Array.isArray(record.Processes)) return record.Processes;
  }
  return asList(value);
}

export function normalizeLawsuitList(items: unknown, source?: string): Lawsuit[] {
  return coerceLawsuitRows(items)
    .map((item) => normalizeLawsuitItem(item, source))
    .filter(
      (item) =>
        item.court != null || item.caseNumber != null || item.type != null || item.status != null,
    );
}

const LAWSUIT_PATHS = new Set([
  'sections.litigation.lawsuits',
  'sections.litigationEsg.lawsuits',
  'sections.litigation.criminalRecords',
]);

export function normalizeLawsuitsInMapped(mapped: Record<string, unknown>): void {
  for (const path of LAWSUIT_PATHS) {
    const value = mapped[path];
    if (value === undefined || value === null) continue;
    if (path.endsWith('criminalRecords')) {
      if (!Array.isArray(value) || value.length === 0) continue;
      mapped[path] = asList(value).map((item) => asRecord(item));
      continue;
    }
    const rows = coerceLawsuitRows(value);
    if (rows.length === 0) {
      delete mapped[path];
      continue;
    }
    mapped[path] = normalizeLawsuitList(rows);
  }
}
