import { normalizeCadastralInMapped } from './cadastral.normalizer.js';
import { normalizeContactsInMapped } from './contacts.normalizer.js';
import { normalizeLawsuitsInMapped } from './lawsuit.normalizer.js';
import { normalizeProtestsInMapped } from './protest.normalizer.js';
import { normalizeQsaInMapped } from './qsa.normalizer.js';
import { normalizeSanctionsInMapped } from './sanctions.normalizer.js';

export function normalizeMappedPayload(mapped: Record<string, unknown>): Record<string, unknown> {
  normalizeCadastralInMapped(mapped);
  normalizeContactsInMapped(mapped);
  normalizeProtestsInMapped(mapped);
  normalizeQsaInMapped(mapped);
  normalizeLawsuitsInMapped(mapped);
  normalizeSanctionsInMapped(mapped);
  return mapped;
}

export * from './cadastral.normalizer.js';
export * from './contacts.normalizer.js';
export * from './lawsuit.normalizer.js';
export * from './protest.normalizer.js';
export * from './qsa.normalizer.js';
export * from './sanctions.normalizer.js';
