import { describe, expect, it } from 'vitest';
import type { ComplianceDossier } from '../../contracts/types/compliance-dossier.types.js';
import { ComplianceStatus } from '../../contracts/enums/compliance-status.enum.js';
import { RiskLevel } from '../../contracts/enums/risk-level.enum.js';
import { emptyPfSections } from '../../contracts/types/canonical/pf.types.js';
import { emptyPjSections } from '../../contracts/types/canonical/pj.types.js';
import {
  buildSliceEnvelope,
  getSliceCatalogEntry,
  isSliceCompatible,
  listDossierSlices,
  projectDossierSlice,
} from './dossier.slices.js';

function baseMeta(documentType: 'CPF' | 'CNPJ', document: string) {
  return {
    dossierId: 'd-1',
    document,
    documentType,
    version: 1,
    generatedAt: '2026-09-14T12:00:00.000Z',
    completeness: 0.5,
    hash: 'abc123',
  };
}

function baseRisk() {
  return {
    level: RiskLevel.baixo,
    score: 0,
    factors: [],
    complianceStatus: ComplianceStatus.aprovado,
    blocked: false,
    requiresManualReview: false,
    recommendation: null,
  };
}

function pfDossier(): ComplianceDossier {
  const sections = emptyPfSections();
  sections.cadastral.fullName = 'Maria Silva';
  sections.cadastral.cpfStatus = 'REGULAR';
  sections.cadastral.phones = [
    { ddd: 11, number: '999999999', type: 'mobile', ranking: 1, whatsapp: true, plus: null },
  ];
  sections.cadastral.emails = [{ email: 'maria@example.com', ranking: 1, hasCookie: null }];
  sections.litigation.lawsuits = [
    { court: 'TJSP', type: 'Cível', status: 'Ativo', amount: 1000, caseNumber: '123' },
  ];
  sections.litigation.criminalRecords = [{ type: 'antecedente' }];
  sections.financial.protests = [{ amount: 500, status: 'ativo', date: '2024-01-01' }];
  sections.pldft.isPep = false;
  sections.pldft.sanctionsHits = [];

  return {
    meta: baseMeta('CPF', '52998224725'),
    subject: { type: 'PF', fullName: 'Maria Silva' },
    risk: baseRisk(),
    compliance: { status: ComplianceStatus.aprovado, blocked: false, alerts: [] },
    sections,
    sources: [],
    audit: { requestedBy: null, reportHash: 'abc123' },
  };
}

function pjDossier(): ComplianceDossier {
  const sections = emptyPjSections();
  sections.cadastral.legalName = 'ACME LTDA';
  sections.cadastral.tradeName = 'ACME';
  sections.cadastral.cnae = '6201501';
  sections.cadastral.cnaeDescription = 'Desenvolvimento de software';
  sections.cadastral.companyType = 'LTDA';
  sections.cadastral.phones = [
    { ddd: 11, number: '33334444', type: 'landline', ranking: 1, whatsapp: null, plus: null },
  ];
  sections.cadastral.emails = [{ email: 'contato@acme.com', ranking: 1, hasCookie: null }];
  sections.corporateStructure.qsa = [
    { name: 'João', document: '52998224725', role: 'Sócio', sharePercent: 50 },
  ];
  sections.corporateStructure.uboTree = [
    { document: '52998224725', name: 'João', level: 1, children: [] },
  ];
  sections.litigationEsg.lawsuits = [
    { court: 'TRT2', type: 'Trabalhista', status: 'Encerrado', amount: null },
  ];
  sections.fiscalHealth.protests = [{ amount: 200, status: 'pago', date: '2023-06-01' }];

  return {
    meta: baseMeta('CNPJ', '58426534000164'),
    subject: { type: 'PJ', legalName: 'ACME LTDA', tradeName: 'ACME' },
    risk: baseRisk(),
    compliance: { status: ComplianceStatus.aprovado, blocked: false, alerts: [] },
    sections,
    sources: [],
    audit: { requestedBy: null, reportHash: 'abc123' },
  };
}

describe('dossier.slices', () => {
  it('lists catalog entries with expected slices', () => {
    const items = listDossierSlices();
    expect(items.find((s) => s.id === 'contacts')).toBeDefined();
    expect(items.find((s) => s.id === 'lawsuits')).toBeDefined();
    expect(items.find((s) => s.id === 'qsa')?.documentTypes).toBe('CNPJ');
    expect(items.find((s) => s.id === 'pldft')?.documentTypes).toBe('CPF');
    expect(getSliceCatalogEntry('unknown')).toBeUndefined();
  });

  it('validates documentType compatibility', () => {
    expect(isSliceCompatible('contacts', 'CPF')).toBe(true);
    expect(isSliceCompatible('contacts', 'CNPJ')).toBe(true);
    expect(isSliceCompatible('qsa', 'CPF')).toBe(false);
    expect(isSliceCompatible('qsa', 'CNPJ')).toBe(true);
    expect(isSliceCompatible('pldft', 'CNPJ')).toBe(false);
  });

  it('projects PF contacts with name, phones and emails', () => {
    const data = projectDossierSlice(pfDossier(), 'contacts');
    expect(data).toEqual({
      fullName: 'Maria Silva',
      phones: [
        { ddd: 11, number: '999999999', type: 'mobile', ranking: 1, whatsapp: true, plus: null },
      ],
      emails: [{ email: 'maria@example.com', ranking: 1, hasCookie: null }],
    });
  });

  it('projects PF lawsuits including criminalRecords', () => {
    const data = projectDossierSlice(pfDossier(), 'lawsuits');
    expect(data.lawsuits).toHaveLength(1);
    expect((data.lawsuits as { type: string }[])[0].type).toBe('Cível');
    expect(data.criminalRecords).toEqual([{ type: 'antecedente' }]);
  });

  it('projects PJ qsa and cnae', () => {
    const dossier = pjDossier();
    expect(projectDossierSlice(dossier, 'qsa')).toEqual({
      qsa: [{ name: 'João', document: '52998224725', role: 'Sócio', sharePercent: 50 }],
    });
    expect(projectDossierSlice(dossier, 'cnae')).toMatchObject({
      cnae: '6201501',
      cnaeDescription: 'Desenvolvimento de software',
      companyType: 'LTDA',
    });
  });

  it('builds envelope with meta and pruned data', () => {
    const envelope = buildSliceEnvelope(pfDossier(), 'identity');
    expect(envelope.slice).toBe('identity');
    expect(envelope.document).toBe('52998224725');
    expect(envelope.meta.hash).toBe('abc123');
    expect(envelope.data.fullName).toBe('Maria Silva');
    expect(envelope.data.cpfStatus).toBe('REGULAR');
  });

  it('throws on unknown slice projector', () => {
    expect(() => projectDossierSlice(pfDossier(), 'nope')).toThrow(/Unknown dossier slice/);
  });

  it('tolerates pruned sections missing nested blocks', () => {
    const dossier = pjDossier();
    // Simulate pruneEmptyDeep removing empty litigationEsg / fiscalHealth
    delete (dossier.sections as Record<string, unknown>).litigationEsg;
    delete (dossier.sections as Record<string, unknown>).fiscalHealth;

    expect(projectDossierSlice(dossier, 'lawsuits')).toEqual({ lawsuits: [] });
    expect(projectDossierSlice(dossier, 'protests')).toEqual({ protests: [] });
    expect(projectDossierSlice(dossier, 'esg')).toEqual({ environmentalEmbargoes: [] });
  });
});
