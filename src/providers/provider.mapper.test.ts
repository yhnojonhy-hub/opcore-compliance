import { describe, expect, it } from 'vitest';
import { applyFieldMappings } from './provider.mapper.js';

describe('provider.mapper', () => {
  it('maps JSONPath to flat targets', () => {
    const raw = { data: { fullName: 'Maria Silva', isPep: true } };
    const mapped = applyFieldMappings(raw, [
      { source: '$.data.fullName', target: 'sections.cadastral.fullName' },
      { source: '$.data.isPep', target: 'sections.pldft.isPep' },
    ]);
    expect(mapped['sections.cadastral.fullName']).toBe('Maria Silva');
    expect(mapped['sections.pldft.isPep']).toBe(true);
  });
});
