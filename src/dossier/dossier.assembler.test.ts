import { describe, expect, it } from 'vitest';
import { ComplianceStatus } from '../contracts/enums/compliance-status.enum.js';
import { RiskLevel } from '../contracts/enums/risk-level.enum.js';
import { assembleDossier } from './dossier.assembler.js';

const emptyRisk = {
  level: RiskLevel.baixo,
  score: 0,
  factors: [],
  complianceStatus: ComplianceStatus.pendente,
  blocked: false,
  requiresManualReview: false,
  recommendation: null,
};

describe('assembleDossier incremental merge', () => {
  it('merges complementary fields from multiple consultations', () => {
    const dossier = assembleDossier({
      document: '10573521000174',
      documentType: 'CNPJ',
      version: 1,
      consultations: [
        {
          providerSlug: 'bigdatacorp-cnpj',
          consultedAt: new Date('2026-01-01T00:00:00Z'),
          cacheHit: false,
          priority: 10,
          payload: {
            'sections.cadastral.legalName': 'OPEN KNOWLEDGE BRASIL',
          },
          rawPayload: {},
          fieldMappings: [],
        },
        {
          providerSlug: 'bigdatacorp-pj-relationships',
          consultedAt: new Date('2026-01-02T00:00:00Z'),
          cacheHit: false,
          priority: 10,
          payload: {
            'sections.corporateStructure.qsa': [{ name: 'Alice', document: '111' }],
          },
          rawPayload: {},
          fieldMappings: [],
        },
      ],
      risk: emptyRisk,
    });

    const sections = dossier.sections as {
      cadastral: { legalName?: string };
      corporateStructure: { qsa?: unknown[] };
    };

    expect(sections.cadastral.legalName).toBe('OPEN KNOWLEDGE BRASIL');
    expect(sections.corporateStructure.qsa).toHaveLength(1);
    expect(dossier.sources).toHaveLength(2);
  });
});
