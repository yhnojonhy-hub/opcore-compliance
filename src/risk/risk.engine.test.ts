import { describe, expect, it } from 'vitest';
import { ComplianceStatus } from '../contracts/enums/compliance-status.enum.js';
import { RiskLevel } from '../contracts/enums/risk-level.enum.js';
import type { ComplianceDossier } from '../contracts/types/compliance-dossier.types.js';
import { emptyPfSections, emptyPjSections } from '../contracts/types/compliance-dossier.types.js';
import { evaluateRisk } from './risk.engine.js';

function basePfDossier(overrides: Partial<ComplianceDossier> = {}): ComplianceDossier {
  return {
    meta: {
      document: '52998224725',
      documentType: 'CPF',
      version: 1,
      generatedAt: new Date().toISOString(),
      completeness: 0.8,
      hash: 'sha256:test',
    },
    subject: { type: 'PF', fullName: 'Maria' },
    risk: {
      level: RiskLevel.baixo,
      score: 0,
      factors: [],
      complianceStatus: ComplianceStatus.pendente,
      blocked: false,
      requiresManualReview: false,
      recommendation: null,
    },
    compliance: { status: ComplianceStatus.pendente, blocked: false, alerts: [] },
    sections: emptyPfSections(),
    sources: [],
    audit: { requestedBy: null, reportHash: 'sha256:test' },
    ...overrides,
  };
}

function basePjDossier(overrides: Partial<ComplianceDossier> = {}): ComplianceDossier {
  return {
    meta: {
      document: '58426534000164',
      documentType: 'CNPJ',
      version: 1,
      generatedAt: new Date().toISOString(),
      completeness: 0.75,
      hash: 'sha256:test',
    },
    subject: { type: 'PJ', legalName: 'INDEX CORE', tradeName: null },
    risk: {
      level: RiskLevel.baixo,
      score: 0,
      factors: [],
      complianceStatus: ComplianceStatus.pendente,
      blocked: false,
      requiresManualReview: false,
      recommendation: null,
    },
    compliance: { status: ComplianceStatus.pendente, blocked: false, alerts: [] },
    sections: emptyPjSections(),
    sources: [],
    audit: { requestedBy: null, reportHash: 'sha256:test' },
    ...overrides,
  };
}

const rule = (partial: Record<string, unknown>) => ({
  id: '1',
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  hardStop: false,
  minRiskLevel: null,
  ...partial,
});

describe('risk.engine', () => {
  const pepRule = rule({
    code: 'PEP_FLAG',
    name: 'PEP',
    documentTypes: ['CPF'],
    condition: { path: 'sections.pldft.isPep', operator: 'truthy' },
    weight: 40,
    severity: 'alta',
    minRiskLevel: 'alto',
  });

  it('applies PEP floor to alto for PF', () => {
    const sections = emptyPfSections();
    sections.pldft.isPep = true;
    const result = evaluateRisk(basePfDossier({ sections }), [pepRule], 'CPF');
    expect(result.level).toBe(RiskLevel.alto);
    expect(result.factors).toHaveLength(1);
  });

  it('returns baixo for clean PF dossier', () => {
    const result = evaluateRisk(basePfDossier(), [pepRule], 'CPF');
    expect(result.level).toBe(RiskLevel.baixo);
    expect(result.complianceStatus).toBe(ComplianceStatus.aprovado);
  });

  it('flags PJ sanctions via internationalHits path', () => {
    const sections = emptyPjSections();
    sections.sanctions.internationalHits = [{ source: 'OFAC' }];
    const sanctionsRule = rule({
      code: 'SANCTIONS_HIT',
      name: 'Sanções',
      documentTypes: ['CPF', 'CNPJ'],
      condition: {
        or: [
          {
            documentType: 'CPF',
            path: 'sections.pldft.sanctionsHits',
            operator: 'array_not_empty',
          },
          {
            documentType: 'CNPJ',
            path: 'sections.sanctions.internationalHits',
            operator: 'array_not_empty',
          },
        ],
      },
      weight: 60,
      severity: 'alta',
    });

    const result = evaluateRisk(basePjDossier({ sections }), [sanctionsRule], 'CNPJ');
    expect(result.factors.some((f) => f.code === 'SANCTIONS_HIT')).toBe(true);
    expect(result.level).toBe(RiskLevel.alto);
  });

  it('hard-stops PJ_SANCTIONED', () => {
    const sections = emptyPjSections();
    sections.sanctions.isCurrentlySanctioned = true;
    const sanctionedRule = rule({
      code: 'PJ_SANCTIONED',
      name: 'Sancionada',
      documentTypes: ['CNPJ'],
      condition: { path: 'sections.sanctions.isCurrentlySanctioned', operator: 'truthy' },
      weight: 80,
      severity: 'critica',
      hardStop: true,
      minRiskLevel: 'muito_alto',
    });

    const result = evaluateRisk(basePjDossier({ sections }), [sanctionedRule], 'CNPJ');
    expect(result.blocked).toBe(true);
    expect(result.complianceStatus).toBe(ComplianceStatus.rejeitado);
    expect(result.level).toBe(RiskLevel.muito_alto);
  });

  it('detects negative certificate in certificates block', () => {
    const sections = emptyPjSections();
    sections.certificates = {
      pgfn: { status: 'negativa', issuedAt: '2026-01-01' },
    };
    const certRule = rule({
      code: 'CERTIFICATE_NEGATIVE',
      name: 'Certidão negativa',
      documentTypes: ['CNPJ'],
      condition: { path: 'sections.certificates', operator: 'certificate_negative' },
      weight: 50,
      severity: 'alta',
      minRiskLevel: 'alto',
    });

    const result = evaluateRisk(basePjDossier({ sections }), [certRule], 'CNPJ');
    expect(result.factors.some((f) => f.code === 'CERTIFICATE_NEGATIVE')).toBe(true);
    expect(result.level).toBe(RiskLevel.alto);
  });

  it('returns baixo for INDEX CORE-like clean PJ dossier', () => {
    const sections = emptyPjSections();
    sections.cadastral.cnpjStatus = 'ATIVA';
    sections.cadastral.legalName = 'INDEX CORE INVESTMENTS ASSET MANAGEMENT LTDA';
    sections.sanctions.isCurrentlyPep = false;
    sections.sanctions.isCurrentlySanctioned = false;
    sections.sanctions.internationalHits = [];

    const pjRules = [
      rule({
        code: 'SANCTIONS_HIT',
        name: 'Sanções',
        documentTypes: ['CPF', 'CNPJ'],
        condition: {
          or: [
            {
              documentType: 'CPF',
              path: 'sections.pldft.sanctionsHits',
              operator: 'array_not_empty',
            },
            {
              documentType: 'CNPJ',
              path: 'sections.sanctions.internationalHits',
              operator: 'array_not_empty',
            },
          ],
        },
        weight: 60,
        severity: 'alta',
      }),
      rule({
        code: 'PJ_SANCTIONED',
        name: 'Sancionada',
        documentTypes: ['CNPJ'],
        condition: { path: 'sections.sanctions.isCurrentlySanctioned', operator: 'truthy' },
        weight: 80,
        severity: 'critica',
        hardStop: true,
      }),
      rule({
        code: 'CNPJ_IRREGULAR',
        name: 'CNPJ irregular',
        documentTypes: ['CNPJ'],
        condition: {
          and: [
            { path: 'sections.cadastral.cnpjStatus', operator: 'truthy' },
            { path: 'sections.cadastral.cnpjStatus', operator: 'neq', value: 'ATIVA' },
          ],
        },
        weight: 50,
        severity: 'alta',
      }),
    ];

    const result = evaluateRisk(basePjDossier({ sections }), pjRules, 'CNPJ');
    expect(result.level).toBe(RiskLevel.baixo);
    expect(result.complianceStatus).toBe(ComplianceStatus.aprovado);
  });
});
