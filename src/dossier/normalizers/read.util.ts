import { asRecord } from '../../providers/adapters/http.util.js';

export function readString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

export function readNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function readBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'sim', 'yes', '1'].includes(normalized)) return true;
    if (['false', 'nao', 'não', 'no', '0'].includes(normalized)) return false;
  }
  return null;
}

export { asRecord };
