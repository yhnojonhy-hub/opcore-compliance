function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) {
    return true;
  }
  return false;
}

export interface PruneOptions {
  preserveKeys?: string[];
}

export function pruneEmptyDeep<T>(value: T, options?: PruneOptions): T {
  const preserve = new Set(options?.preserveKeys ?? []);

  const prune = (input: unknown, path: string): unknown => {
    if (Array.isArray(input)) {
      const pruned = input
        .map((item, index) => prune(item, `${path}[${index}]`))
        .filter((item) => !isEmptyValue(item));
      return pruned;
    }

    if (input && typeof input === 'object') {
      const record = input as Record<string, unknown>;
      const out: Record<string, unknown> = {};

      for (const [key, child] of Object.entries(record)) {
        const childPath = path ? `${path}.${key}` : key;
        if (preserve.has(key) || preserve.has(childPath)) {
          out[key] = child;
          continue;
        }

        const prunedChild = prune(child, childPath);
        if (!isEmptyValue(prunedChild)) {
          out[key] = prunedChild;
        }
      }

      return out;
    }

    return input;
  };

  return prune(value, '') as T;
}
