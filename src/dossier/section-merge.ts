export interface MergeContext {
  priority: number;
  consultedAt: Date;
  providerSlug: string;
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

function itemKey(item: unknown): string {
  if (item === null || item === undefined) return String(item);
  if (typeof item !== 'object') return JSON.stringify(item);
  const obj = item as Record<string, unknown>;
  if (obj.document != null) return `doc:${String(obj.document)}`;
  if (obj.name != null && obj.role != null) {
    return `name-role:${String(obj.name)}|${String(obj.role)}`;
  }
  if (obj.name != null) return `name:${String(obj.name)}`;
  if (obj.court != null && obj.type != null) {
    return `lawsuit:${String(obj.court)}|${String(obj.type)}`;
  }
  return JSON.stringify(item);
}

function dedupeArray(items: unknown[]): unknown[] {
  const seen = new Set<string>();
  const result: unknown[] = [];
  for (const item of items) {
    const key = itemKey(item);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

function shouldReplaceScalar(
  existing: unknown,
  incoming: unknown,
  existingCtx: MergeContext | null,
  incomingCtx: MergeContext,
): boolean {
  if (isEmpty(existing)) return true;
  if (isEmpty(incoming)) return false;
  if (!existingCtx) return true;

  if (incomingCtx.priority !== existingCtx.priority) {
    return incomingCtx.priority > existingCtx.priority;
  }
  return incomingCtx.consultedAt.getTime() >= existingCtx.consultedAt.getTime();
}

type ScalarMeta = { value: unknown; ctx: MergeContext | null };

const scalarMeta = new WeakMap<object, Map<string, ScalarMeta>>();

function getMetaMap(target: object): Map<string, ScalarMeta> {
  let map = scalarMeta.get(target);
  if (!map) {
    map = new Map();
    scalarMeta.set(target, map);
  }
  return map;
}

function mergeValues(
  existing: unknown,
  incoming: unknown,
  path: string,
  targetRoot: object,
  existingCtx: MergeContext | null,
  incomingCtx: MergeContext,
): unknown {
  if (isEmpty(incoming)) return existing;
  if (isEmpty(existing)) {
    if (!Array.isArray(incoming) && incoming !== null && typeof incoming === 'object') {
      return mergeObject(
        {},
        incoming as Record<string, unknown>,
        path,
        targetRoot,
        null,
        incomingCtx,
      );
    }
    getMetaMap(targetRoot).set(path, { value: incoming, ctx: incomingCtx });
    return incoming;
  }

  if (Array.isArray(existing) && Array.isArray(incoming)) {
    return dedupeArray([...existing, ...incoming]);
  }

  if (Array.isArray(existing) || Array.isArray(incoming)) {
    const chosen = shouldReplaceScalar(existing, incoming, existingCtx, incomingCtx)
      ? incoming
      : existing;
    getMetaMap(targetRoot).set(path, {
      value: chosen,
      ctx: shouldReplaceScalar(existing, incoming, existingCtx, incomingCtx)
        ? incomingCtx
        : existingCtx,
    });
    return chosen;
  }

  if (
    existing !== null &&
    typeof existing === 'object' &&
    incoming !== null &&
    typeof incoming === 'object'
  ) {
    return mergeObject(
      existing as Record<string, unknown>,
      incoming as Record<string, unknown>,
      path,
      targetRoot,
      existingCtx,
      incomingCtx,
    );
  }

  if (shouldReplaceScalar(existing, incoming, existingCtx, incomingCtx)) {
    getMetaMap(targetRoot).set(path, { value: incoming, ctx: incomingCtx });
    return incoming;
  }
  return existing;
}

function mergeObject(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
  basePath: string,
  targetRoot: object,
  existingCtx: MergeContext | null,
  incomingCtx: MergeContext,
): Record<string, unknown> {
  const result = { ...existing };
  const metaMap = getMetaMap(targetRoot);

  for (const [key, incomingValue] of Object.entries(incoming)) {
    const path = basePath ? `${basePath}.${key}` : key;
    const existingValue = result[key];
    const fieldMeta = metaMap.get(path);
    const fieldExistingCtx = fieldMeta?.ctx ?? existingCtx;

    result[key] = mergeValues(
      existingValue,
      incomingValue,
      path,
      targetRoot,
      fieldExistingCtx,
      incomingCtx,
    );
  }

  return result;
}

/**
 * Merges flat mapped keys (e.g. sections.cadastral.legalName) into section blocks
 * using fill-gap, array concat, and priority/recency for scalar conflicts.
 */
export function mergeMappedIntoSectionsIncremental(
  mapped: Record<string, unknown>,
  sections: Record<string, Record<string, unknown>>,
  ctx: MergeContext,
): void {
  const targetRoot = sections;

  for (const [key, value] of Object.entries(mapped)) {
    if (!key.startsWith('sections.')) {
      const blockKey = key.split('.')[0];
      if (!sections[blockKey]) sections[blockKey] = {};
      const path = key;
      const metaMap = getMetaMap(targetRoot);
      const fieldMeta = metaMap.get(path);
      sections[blockKey] = mergeObject(
        sections[blockKey],
        { [key.split('.').slice(1).join('.') || key]: value },
        `sections.${blockKey}`,
        targetRoot,
        fieldMeta?.ctx ?? null,
        ctx,
      );
      continue;
    }

    const parts = key.replace(/^sections\./, '').split('.');
    const block = parts[0];
    const field = parts.slice(1).join('.');

    if (!sections[block]) sections[block] = {};

    if (!field) {
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        sections[block] = mergeObject(
          sections[block],
          value as Record<string, unknown>,
          `sections.${block}`,
          targetRoot,
          null,
          ctx,
        );
      }
      continue;
    }

    const path = `sections.${block}.${field}`;
    const metaMap = getMetaMap(targetRoot);
    const fieldMeta = metaMap.get(path);
    const existingValue = sections[block][field];

    sections[block][field] = mergeValues(
      existingValue,
      value,
      path,
      targetRoot,
      fieldMeta?.ctx ?? null,
      ctx,
    );
  }
}
