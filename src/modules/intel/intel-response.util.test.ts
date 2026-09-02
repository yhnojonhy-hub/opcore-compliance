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

  it('preserves consultedAbsent findings through serialize', () => {
    const dossier: IntelDossierResponse = {
      id: 'd1',
      target: '37740937843',
      targetType: 'CPF',
      status: 'COMPLETED',
      overallScore: 70,
      scoreLabel: 'MEDIA',
      purpose: 'KYC',
      legalBasis: 'LEGITIMATE_INTEREST',
      deepSearch: false,
      findings: [
        {
          id: 'f1',
          category: 'LAWSUIT',
          sourceName: 'BigDataCorp',
          reliability: 'PAID',
          confidence: 70,
          title: 'Consultado — nada consta em processos judiciais',
          summary: 'BigDataCorp foi consultado e não retornou registro.',
          details: { consultedAbsent: true, status: 'CHECKED_ABSENT' },
          verified: true,
        },
      ],
      sources: [],
      pillars: {
        bdc: {
          id: 'bdc',
          label: 'BigDataCorp',
          status: 'ok',
          providerCount: 1,
          findingCount: 1,
        },
        lemit: {
          id: 'lemit',
          label: 'Lemit',
          status: 'skipped',
          providerCount: 0,
          findingCount: 0,
        },
        brasilapi: {
          id: 'brasilapi',
          label: 'Brasil API',
          status: 'skipped',
          providerCount: 0,
          findingCount: 0,
        },
        extras: {
          id: 'extras',
          label: 'Extras / OSINT',
          status: 'ok',
          providerCount: 1,
          findingCount: 0,
        },
      },
      canonical: { risk: { level: 'baixo', score: 10 } } as IntelDossierResponse['canonical'],
      riskBrief: { overall: 'GREEN', categories: [] },
      intelBrief: {
        headline: 'ok',
        estimative: 'improvável',
        confidence: 'baixa',
        judgements: [],
        checkedAbsent: ['Processos'],
        gaps: [],
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const serialized = serializeIntelDossierResponse(dossier);
    expect(serialized.findings).toHaveLength(1);
    expect(serialized.findings[0].details.consultedAbsent).toBe(true);
    expect(serialized.pillars?.bdc.status).toBe('ok');
    expect(serialized.canonical).toEqual({ risk: { level: 'baixo', score: 10 } });
  });
});
