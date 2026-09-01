import { describe, expect, it } from 'vitest';
import { markCrossValidated, scoreDossier, scoreFinding } from './scoring.js';
import { assessDossierRisk, buildIntelBrief } from './brief.js';
import { isValidTarget } from '../providers/adapters/registry.js';
import { providersFor, slugForProvider, listAdapterMeta } from '../providers/adapters/registry.js';
import { findingsToSections } from '../dossier/intel-bridge.js';
import type { ProviderContext } from '../providers/adapters/types.js';

describe('intel scoring', () => {
  it('scores verified findings higher', () => {
    const base = scoreFinding({
      confidence: 80,
      reliability: 'OFFICIAL',
      verified: false,
    });
    const verified = scoreFinding({
      confidence: 80,
      reliability: 'OFFICIAL',
      verified: true,
    });
    expect(verified).toBeGreaterThan(base);
  });

  it('marks cross-validated findings', () => {
    const findings = markCrossValidated([
      { title: 'Empresa X', summary: 'CNPJ ativo' },
      { title: 'Empresa X', summary: 'CNPJ ativo' },
      { title: 'Outro', summary: 'Sem registro' },
    ]);
    expect(findings.filter((f) => f.verified)).toHaveLength(2);
  });

  it('returns default score when no findings', () => {
    expect(scoreDossier([])).toBe(50);
  });
});

describe('intel brief', () => {
  it('builds risk brief for sanctions', () => {
    const risk = assessDossierRisk([
      {
        category: 'SANCTION',
        title: 'CEIS',
        summary: 'Empresa consta na lista CEIS',
      },
    ]);
    expect(risk.overall).toBe('RED');
  });

  it('builds intel brief with gaps', () => {
    const brief = buildIntelBrief({
      purpose: 'KYC',
      score: 60,
      findings: [],
      sources: [{ name: 'DataJud CNJ', status: 'error', error: 'timeout' }],
    });
    expect(brief.gaps.length).toBeGreaterThan(0);
    expect(brief.headline).toContain('Leitura');
  });
});

describe('adapter registry', () => {
  it('lists 33 active OSINT adapters excluding stubs', () => {
    const meta = listAdapterMeta();
    expect(meta.length).toBeGreaterThanOrEqual(33);
    expect(slugForProvider('Minha Receita')).toBe('osint-minha-receita');
  });

  it('selects CNPJ sync providers', () => {
    const ctx: ProviderContext = {
      target: '58426534000164',
      targetType: 'CNPJ',
      aliases: [],
      deepSearch: false,
      paidProviders: [],
      priorFindings: [],
    };
    const sync = providersFor(ctx, 'sync');
    expect(sync.some((p) => p.name === 'Minha Receita')).toBe(true);
    expect(sync.some((p) => p.name === 'BNMP 3.0')).toBe(false);
  });
});

describe('isValidTarget', () => {
  it('validates homolog CNPJ', () => {
    expect(isValidTarget('CNPJ', '58426534000164')).toBe(true);
  });
});

describe('intel-bridge', () => {
  it('maps sanction findings to sections', () => {
    const sections = findingsToSections([
      {
        id: '1',
        category: 'SANCTION',
        sourceName: 'Portal',
        reliability: 'OFFICIAL',
        confidence: 90,
        title: 'CEIS',
        summary: 'Consta',
        details: {},
        verified: false,
      },
    ]);
    expect(sections.sanctions?.sanctionFindings).toBeDefined();
  });
});
