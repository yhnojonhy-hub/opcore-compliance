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
      merged.alias,
      merged.orgaoJulgador,
      merged.siglaTribunal,
    ),
    type: readString(merged.classe, merged.type, merged.tipo, merged.assunto),
    status: readString(merged.status, merged.situacao, merged.situation),
    amount: readNumber(merged.valor, merged.amount, merged.Value),
    caseNumber: readString(
      record.caseNumber,
      merged.numeroProcesso,
      merged.processNumber,
      merged.numero,
      merged.number,
    ),
    filedAt: readString(merged.dataAjuizamento, merged.filedAt, merged.data),
    source: source ?? readString(merged.source, merged.fonte),
  };
}

export function normalizeLawsuitList(items: unknown, source?: string): Lawsuit[] {
  return asList(items)
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
    if (!Array.isArray(value) || value.length === 0) continue;
    if (path.endsWith('criminalRecords')) {
      mapped[path] = asList(value).map((item) => asRecord(item));
      continue;
    }
    mapped[path] = normalizeLawsuitList(value);
  }
}
