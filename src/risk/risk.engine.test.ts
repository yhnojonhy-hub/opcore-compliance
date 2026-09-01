import { describe, expect, it } from 'vitest';
import { ComplianceStatus } from '../contracts/enums/compliance-status.enum.js';
import { RiskLevel } from '../contracts/enums/risk-level.enum.js';
import type { ComplianceDossier } from '../contracts/types/compliance-dossier.types.js';
import { emptyPfSections } from '../contracts/types/compliance-dossier.types.js';
import { evaluateRisk } from './risk.engine.js';

function baseDossier(overrides: Partial<ComplianceDossier> = {}): ComplianceDossier {
  const sections = emptyPfSections();
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
    sections,
    sources: [],
    audit: { requestedBy: null, reportHash: 'sha256:test' },
    ...overrides,
  };
}

describe('risk.engine', () => {
  const pepRule = {
    id: '1',
    code: 'PEP_FLAG',
    name: 'PEP',
    documentTypes: ['CPF'],
    condition: { path: 'sections.pldft.isPep', operator: 'truthy' },
    weight: 40,
    severity: 'alta',
    hardStop: false,
    minRiskLevel: 'alto' as const,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('applies PEP floor to alto', () => {
    const sections = emptyPfSections();
    sections.pldft.isPep = true;
    const dossier = baseDossier({ sections });
    const result = evaluateRisk(dossier, [pepRule], 'CPF');
    expect(result.level).toBe(RiskLevel.alto);
    expect(result.factors).toHaveLength(1);
  });

  it('returns baixo for clean dossier', () => {
    const result = evaluateRisk(baseDossier(), [pepRule], 'CPF');
    expect(result.level).toBe(RiskLevel.baixo);
    expect(result.complianceStatus).toBe(ComplianceStatus.aprovado);
  });
});
