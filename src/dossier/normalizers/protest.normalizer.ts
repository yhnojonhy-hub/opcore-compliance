import type { Protest } from '../../contracts/types/canonical/shared.types.js';
import { asList } from '../../contracts/utils/array.util.js';
import { asRecord, readNumber, readString } from './read.util.js';

function isLemitProtest(item: Record<string, unknown>): boolean {
  return 'valor' in item || 'cartorio' in item;
}

export function normalizeProtestItem(raw: unknown): Protest {
  const record = asRecord(raw);

  if (isLemitProtest(record)) {
    return {
      amount: readNumber(record.valor, record.amount, record.Value),
      status: readString(record.status, record.situacao) ?? 'ativo',
      date: readString(record.data, record.date, record.Data),
      registry: readString(record.cartorio, record.registry),
      city: readString(record.cidade, record.city),
      state: readString(record.uf, record.state),
    };
  }

  return {
    amount: readNumber(record.amount, record.valor, record.Value, record.value),
    status: readString(record.status, record.situacao, record.situation),
    date: readString(record.date, record.data, record.Data),
    registry: readString(record.registry, record.cartorio),
    city: readString(record.city, record.cidade),
    state: readString(record.state, record.uf),
  };
}

export function normalizeProtestList(items: unknown): Protest[] {
  return asList(items)
    .map(normalizeProtestItem)
    .filter((item) => item.amount != null || item.date != null);
}

const PROTEST_PATHS = new Set(['sections.financial.protests', 'sections.fiscalHealth.protests']);

export function normalizeProtestsInMapped(mapped: Record<string, unknown>): void {
  for (const path of PROTEST_PATHS) {
    const value = mapped[path];
    if (!Array.isArray(value) || value.length === 0) continue;
    mapped[path] = normalizeProtestList(value);
  }
}
