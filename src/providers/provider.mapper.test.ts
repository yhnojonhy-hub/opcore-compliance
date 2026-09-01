import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyFieldMappings } from './provider.mapper.js';
import { loadProviderSeed } from '../../prisma/provider-seeds.manifest.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, name), 'utf-8'));
}

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

  it('maps Brasil API CNPJ response to canonical PJ paths', () => {
    const seed = loadProviderSeed('providers/brasilapi-cnpj.json');
    const raw = loadFixture('brasilapi-cnpj-response.json');
    const mapped = applyFieldMappings(raw, seed.fieldMappings);

    expect(mapped['sections.cadastral.legalName']).toBe('OPEN KNOWLEDGE BRASIL');
    expect(mapped['sections.cadastral.tradeName']).toBe('REDE PELO CONHECIMENTO LIVRE');
    expect(mapped['sections.cadastral.cnpjStatus']).toBe('ATIVA');
    expect(mapped['sections.cadastral.openingDate']).toBe('2013-10-03');
    expect(mapped['sections.cadastral.cnae']).toBe(9430800);
    expect(mapped['sections.corporateStructure.qsa']).toHaveLength(1);
    expect(
      (mapped['sections.corporateStructure.qsa'] as { nome_socio: string }[])[0].nome_socio,
    ).toBe('HAYDEE SVAB');
  });

  it('maps Brasil API CPF response to cpfRegular', () => {
    const seed = loadProviderSeed('providers/brasilapi-cpf.json');
    const raw = loadFixture('brasilapi-cpf-response.json');
    const mapped = applyFieldMappings(raw, seed.fieldMappings);

    expect(mapped['sections.cadastral.cpfRegular']).toBe(true);
  });

  it('maps Lemit CPF response to cadastral and financial paths', () => {
    const seed = loadProviderSeed('providers/lemit-cpf.json');
    const raw = loadFixture('lemit-cpf-response.json');
    const mapped = applyFieldMappings(raw, seed.fieldMappings);

    expect(mapped['sections.cadastral.fullName']).toBe('FULANO DE TAL SILVA');
    expect(mapped['sections.cadastral.cpfStatus']).toBe('REGULAR');
    expect(mapped['sections.cadastral.birthDate']).toBe('1990-05-15');
    expect(mapped['sections.cadastral.motherName']).toBe('MARIA DA SILVA');
    expect(mapped['sections.financial.protests']).toHaveLength(1);
  });

  it('maps Lemit CNPJ response to cadastral and fiscalHealth paths', () => {
    const seed = loadProviderSeed('providers/lemit-cnpj.json');
    const raw = loadFixture('lemit-cnpj-response.json');
    const mapped = applyFieldMappings(raw, seed.fieldMappings);

    expect(mapped['sections.cadastral.legalName']).toBe('OPEN KNOWLEDGE BRASIL');
    expect(mapped['sections.cadastral.tradeName']).toBe('REDE PELO CONHECIMENTO LIVRE');
    expect(mapped['sections.cadastral.cnpjStatus']).toBe('ATIVA');
    expect(mapped['sections.fiscalHealth.protests']).toHaveLength(1);
  });

  it('maps BigDataCorp CPF response to cadastral and pldft paths', () => {
    const seed = loadProviderSeed('providers/bigdatacorp-cpf.json');
    const raw = loadFixture('bigdatacorp-cpf-response.json');
    const mapped = applyFieldMappings(raw, seed.fieldMappings);

    expect(mapped['sections.cadastral.fullName']).toBe('FULANO DE TAL SILVA');
    expect(mapped['sections.cadastral.cpfStatus']).toBe('REGULAR');
    expect(mapped['sections.cadastral.birthDate']).toBe('1990-05-15T00:00:00Z');
    expect(mapped['sections.cadastral.motherName']).toBe('MARIA DA SILVA');
    expect(mapped['sections.pldft.isPep']).toBe(true);
    expect(mapped['sections.pldft.sanctionsHits']).toHaveLength(1);
    const hit = mapped['sections.pldft.sanctionsHits'] as {
      matchRate: number;
      matchConfidence: string;
    }[];
    expect(hit[0].matchRate).toBe(46);
    expect(hit[0].matchConfidence).toBe('weak');
    expect(mapped['sections.pldft.sanctionsHitsConfirmed']).toEqual([]);
    expect(mapped['sections.pldft.isSanctioned']).toBe(false);
  });

  it('maps BigDataCorp CNPJ response to cadastral and sanctions paths', () => {
    const seed = loadProviderSeed('providers/bigdatacorp-cnpj.json');
    const raw = loadFixture('bigdatacorp-cnpj-response.json');
    const mapped = applyFieldMappings(raw, seed.fieldMappings);

    expect(mapped['sections.cadastral.legalName']).toBe('OPEN KNOWLEDGE BRASIL');
    expect(mapped['sections.cadastral.tradeName']).toBe('REDE PELO CONHECIMENTO LIVRE');
    expect(mapped['sections.cadastral.cnpjStatus']).toBe('ATIVA');
    expect(mapped['sections.cadastral.openingDate']).toBe('2013-10-03T00:00:00Z');
    expect(mapped['sections.cadastral.cnae']).toBe('9430800');
    expect(mapped['sections.sanctions.isCurrentlyPep']).toBe(false);
    expect(mapped['sections.sanctions.isCurrentlySanctioned']).toBe(false);
    expect(mapped['sections.sanctions.internationalHits']).toEqual([]);
  });

  it('maps BigDataCorp CNPJ INDEX CORE fixture with CNAE and KYC flags', () => {
    const seed = loadProviderSeed('providers/bigdatacorp-cnpj.json');
    const raw = loadFixture('bigdatacorp-cnpj-index-core-response.json');
    const mapped = applyFieldMappings(raw, seed.fieldMappings);

    expect(mapped['sections.cadastral.cnae']).toBe('6630400');
    expect(mapped['sections.cadastral.capital']).toBe('550000.00');
    expect(mapped['sections.cadastral.headquarterState']).toBe('SP');
    expect(mapped['sections.sanctions.isCurrentlyPep']).toBe(false);
    expect(mapped['sections.sanctions.isCurrentlySanctioned']).toBe(false);
    expect(mapped['sections.cadastral.activities']).toHaveLength(2);
  });

  it('maps BigDataCorp PJ relationships to corporateStructure.qsa', () => {
    const seed = loadProviderSeed(
      'providers/bigdatacorp/empresas/bigdatacorp-pj-relationships.json',
    );
    const raw = loadFixture('bigdatacorp-pj-relationships-response.json');
    const mapped = applyFieldMappings(raw, seed.fieldMappings);

    expect(mapped['sections.corporateStructure.qsa']).toHaveLength(1);
  });

  it('maps BigDataCorp PJ owners_lawsuits to litigationEsg.lawsuits', () => {
    const seed = loadProviderSeed(
      'providers/bigdatacorp/empresas/bigdatacorp-pj-owners_lawsuits.json',
    );
    const raw = loadFixture('bigdatacorp-pj-owners_lawsuits-response.json');
    const mapped = applyFieldMappings(raw, seed.fieldMappings);

    expect(mapped['sections.litigationEsg.lawsuits']).toHaveLength(1);
  });

  it('maps BigDataCorp PF processes to litigation.lawsuits', () => {
    const seed = loadProviderSeed('providers/bigdatacorp/pessoas/bigdatacorp-pf-processes.json');
    const raw = loadFixture('bigdatacorp-pf-processes-response.json');
    const mapped = applyFieldMappings(raw, seed.fieldMappings);

    expect(mapped['sections.litigation.lawsuits']).toHaveLength(1);
  });
});
