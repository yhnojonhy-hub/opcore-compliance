import { describe, expect, it } from 'vitest';
import type { IntelDossierResponse } from '../../contracts/types/intel-dossier.types.js';
import { serializeIntelDossierResponse } from './intel-response.util.js';

describe('serializeIntelDossierResponse', () => {
  it('keeps findings, sources and intelBrief.gaps even when empty', () => {
    const dossier: IntelDossierResponse = {
      id: 'd1',
      target: '58426534000164',
      targetType: 'CNPJ',
      status: 'COMPLETED',
      overallScore: 10,
      scoreLabel: 'BAIXA',
      purpose: 'KYC',
      legalBasis: 'LEGITIMATE_INTEREST',
      deepSearch: false,
      findings: [],
      sources: [
        { id: 's1', name: 'Test', category: 'IDENTITY', reliability: 'OFFICIAL', status: 'ok' },
      ],
      riskBrief: { overall: 'GREEN', categories: [] },
      intelBrief: {
        headline: 'ok',
        estimative: 'improvável',
        confidence: 'baixa',
        judgements: [],
        checkedAbsent: [],
        gaps: [],
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const serialized = serializeIntelDossierResponse(dossier);
    expect(serialized.findings).toEqual([]);
    expect(serialized.sources).toHaveLength(1);
    expect(serialized.intelBrief.gaps).toEqual([]);
    expect(serialized.riskBrief.categories).toEqual([]);
  });
});
