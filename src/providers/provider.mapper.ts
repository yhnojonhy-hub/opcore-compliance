import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSONPath } from 'jsonpath-plus';
import type { FieldMapping } from './provider.interface.js';
import { normalizeMappedPayload } from '../dossier/normalizers/index.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function coerceMappedValue(value: unknown): unknown {
  if (
    Array.isArray(value) &&
    value.length === 1 &&
    (typeof value[0] !== 'object' || value[0] === null)
  ) {
    return value[0];
  }
  return value;
}

export function applyFieldMappings(
  rawPayload: unknown,
  mappings: FieldMapping[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const { source, target } of mappings) {
    try {
      const values = JSONPath({ path: source, json: rawPayload as object });
      if (values.length > 0) {
        result[target] = coerceMappedValue(values[0]);
      }
    } catch {
      // partial mapping — skip failed paths
    }
  }

  return normalizeMappedPayload(result);
}

/** Prefer fresh mapping from raw; fall back to stored payload when raw is empty. */
export function resolveMappedPayload(
  rawPayload: unknown,
  fieldMappings: FieldMapping[],
  storedPayload?: Record<string, unknown>,
): Record<string, unknown> {
  const mapped = applyFieldMappings(rawPayload, fieldMappings);
  if (Object.keys(mapped).length > 0) return mapped;
  return storedPayload ?? {};
}

export function loadFixture(fixtureKey: string): unknown {
  const filePath = join(fixturesDir, `${fixtureKey}.json`);
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

export function interpolateTemplate<T>(value: T, ctx: Record<string, string>): T {
  if (typeof value === 'string') {
    return value.replace(/\{\{(\w+)\}\}/g, (_, key) => ctx[key] ?? '') as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => interpolateTemplate(v, ctx)) as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = interpolateTemplate(v, ctx);
    }
    return out as T;
  }
  return value;
}
