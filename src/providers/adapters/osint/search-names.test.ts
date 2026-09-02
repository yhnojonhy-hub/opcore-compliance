import { describe, expect, it } from 'vitest';
import { searchNamesForTest } from './catalog.js';
import type { ProviderContext } from '../types.js';

describe('searchNames', () => {
  it('ignores CPF-only target and keeps partyName', () => {
    const ctx: ProviderContext = {
      target: '37740937843',
      targetType: 'CPF',
      partyName: 'Maria Silva Santos',
      aliases: ['37740937843'],
      deepSearch: false,
      paidProviders: [],
    };
    const names = searchNamesForTest(ctx);
    expect(names).toContain('Maria Silva Santos');
    expect(names.some((name) => /^\d+$/.test(name))).toBe(false);
  });

  it('returns empty when only document digits are available', () => {
    const ctx: ProviderContext = {
      target: '37740937843',
      targetType: 'CPF',
      deepSearch: false,
      paidProviders: [],
    };
    expect(searchNamesForTest(ctx)).toEqual([]);
  });
});
