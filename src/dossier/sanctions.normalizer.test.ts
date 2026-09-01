import { describe, expect, it } from 'vitest';
import {
  classifyMatchRate,
  normalizeBdcSanctionHit,
  normalizeSanctionList,
  normalizeSanctionsInMapped,
} from './sanctions.normalizer.js';

const OFAC_SAMPLE = {
  Source: 'ofac',
  Type: 'Money Laundering',
  StandardizedSanctionType: 'FINANCIAL CRIMES',
  MatchRate: 72,
  NameUniquenessScore: 0.11111111,
  Details: {
    OriginalName: 'JOSE DOMINGOS FERRARI',
    SanctionName: 'JOSE ADELINO ORNELAS FERREIRA',
    BirthDate: '14 Dec 1964',
    StandardizedBirthDate: '1964-12-14T00:00:00',
  },
  IsCurrentlyPresentOnSource: true,
};

describe('sanctions.normalizer', () => {
  it('classifies match rates into confidence bands', () => {
    expect(classifyMatchRate(92)).toBe('confirmed');
    expect(classifyMatchRate(72)).toBe('possible');
    expect(classifyMatchRate(57)).toBe('weak');
  });

  it('normalizes BDC OFAC record', () => {
    const hit = normalizeBdcSanctionHit(OFAC_SAMPLE);
    expect(hit.source).toBe('ofac');
    expect(hit.matchRate).toBe(72);
    expect(hit.matchConfidence).toBe('possible');
    expect(hit.originalName).toBe('JOSE DOMINGOS FERRARI');
    expect(hit.sanctionName).toBe('JOSE ADELINO ORNELAS FERREIRA');
  });

  it('splits confirmed vs fuzzy hits for risk', () => {
    const { all, confirmed, possible } = normalizeSanctionList([
      OFAC_SAMPLE,
      { Source: 'interpol', MatchRate: 57, Details: {}, IsCurrentlyPresentOnSource: true },
      { Source: 'ofac', MatchRate: 91, Details: { OriginalName: 'A', SanctionName: 'A' } },
    ]);
    expect(all).toHaveLength(3);
    expect(confirmed).toHaveLength(1);
    expect(possible).toHaveLength(1);
  });

  it('does not flag isSanctioned when only weak/possible hits exist', () => {
    const mapped: Record<string, unknown> = {
      'sections.pldft.isSanctioned': true,
      'sections.pldft.sanctionsHits': [OFAC_SAMPLE],
    };
    normalizeSanctionsInMapped(mapped);
    expect(mapped['sections.pldft.isSanctioned']).toBe(false);
    expect(mapped['sections.pldft.isSanctionedBdcRaw']).toBe(true);
    expect(mapped['sections.pldft.sanctionsHitsConfirmed']).toEqual([]);
    expect(
      (mapped['sections.pldft.sanctionsHitsSummary'] as { maxMatchRate: number }).maxMatchRate,
    ).toBe(72);
  });
});
