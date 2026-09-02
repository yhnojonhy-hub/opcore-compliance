import { describe, expect, it } from 'vitest';
import { pruneEmptyDeep } from './prune.util.js';

describe('pruneEmptyDeep', () => {
  it('removes empty sections and null fields', () => {
    const input = {
      meta: { document: '123', completeness: 0 },
      sections: {
        cadastral: { fullName: 'Maria', birthDate: null },
        financial: { protests: [], federalDebt: null },
      },
    };

    const result = pruneEmptyDeep(input, { preserveKeys: ['meta'] });
    expect(result.sections.cadastral).toEqual({ fullName: 'Maria' });
    expect(result.sections.financial).toBeUndefined();
  });
});
