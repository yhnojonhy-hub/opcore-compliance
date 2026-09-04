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
    expect((mapped['sections.corporateStructure.qsa'] as { name: string }[])[0].name).toBe(
      'HAYDEE SVAB',
    );
  });

  it('maps Brasil API CPF response to cpfRegular', () => {
    const seed = loadProviderSeed('providers/brasilapi-cpf.json');
    const raw = loadFixture('brasilapi-cpf-response.json');
    const mapped = applyFieldMappings(raw, seed.fieldMappings);

    expect(mapped['sections.cadastral.cpfRegular']).toBe(true);
  });

  it('maps Lemit CPF response to full cadastral, contacts, financial and corporate paths', () => {
    const seed = loadProviderSeed('providers/lemit-cpf.json');
    const raw = loadFixture('lemit-cpf-response.json');
    const mapped = applyFieldMappings(raw, seed.fieldMappings);

    expect(mapped['sections.cadastral.fullName']).toBe('JOAO SILVA');
    expect(mapped['sections.cadastral.cpfStatus']).toBe('REGULAR');
    expect(mapped['sections.cadastral.cpfRegular']).toBe(true);
    expect(mapped['sections.cadastral.birthDate']).toBe('1970-10-01T00:00:00-03:00');
    expect(mapped['sections.cadastral.motherName']).toBe('MARIA SILVA');
    expect(mapped['sections.cadastral.gender']).toBe('M');
    expect(mapped['sections.cadastral.deceased']).toBe(false);
    expect(mapped['sections.cadastral.phones']).toHaveLength(2);
    expect((mapped['sections.cadastral.phones'] as { type: string }[])[0].type).toBe('mobile');
    expect((mapped['sections.cadastral.phones'] as { number: string }[])[0].number).toBe(
      '999990000',
    );
    expect(mapped['sections.cadastral.emails']).toHaveLength(1);
    expect((mapped['sections.cadastral.emails'] as { hasCookie: boolean }[])[0].hasCookie).toBe(
      true,
    );
    expect(mapped['sections.cadastral.addresses']).toHaveLength(1);
    expect((mapped['sections.cadastral.addresses'] as { city: string }[])[0].city).toBe(
      'SAO PAULO',
    );
    expect(mapped['sections.cadastral.vehicles']).toHaveLength(1);
    expect((mapped['sections.cadastral.vehicles'] as { renavam: string }[])[0].renavam).toBe(
      '123456789',
    );
    expect(mapped['sections.corporateLinks.relatedPeople']).toHaveLength(2);
    expect(mapped['sections.corporateLinks.shareholdings']).toHaveLength(2);
    expect(mapped['sections.financial.estimatedIncome']).toBe(788);
    expect(mapped['sections.financial.creditFlags']).toEqual(['BAIXISSIMO RISCO']);
    expect(mapped['sections.financial.financialRiskLevel']).toBe('BAIXISSIMO RISCO');
    expect(mapped['sections.cadastral.mobilePhones']).toBeUndefined();
    expect(mapped['sections.cadastral.landlinePhones']).toBeUndefined();
  });

  it('maps Lemit CNPJ response to cadastral, contacts, vehicles and QSA', () => {
    const seed = loadProviderSeed('providers/lemit-cnpj.json');
    const raw = loadFixture('lemit-cnpj-response.json');
    const mapped = applyFieldMappings(raw, seed.fieldMappings);

    expect(mapped['sections.cadastral.legalName']).toBe('EMPRESA EXEMPLO LTDA ME');
    expect(mapped['sections.cadastral.tradeName']).toBe('EMPRESA EXEMPLO');
    expect(mapped['sections.cadastral.cnpjStatus']).toBe('ATIVA');
    expect(mapped['sections.cadastral.openingDate']).toBe('2001-02-03T00:00:00-03:00');
    expect(mapped['sections.cadastral.companyType']).toBe('ME');
    expect(mapped['sections.cadastral.cnae']).toBe('00001');
    expect(mapped['sections.cadastral.cnaeDescription']).toBe('SERVICOS DE EXEMPLOS DE EMPRESAS');
    expect(mapped['sections.cadastral.activities']).toHaveLength(1);
    expect((mapped['sections.cadastral.activities'] as { numero: string }[])[0].numero).toBe(
      '00002',
    );
    expect(mapped['sections.cadastral.addresses']).toHaveLength(1);
    expect((mapped['sections.cadastral.addresses'] as { line: string }[])[0].line).toBe(
      'AV PAULISTA, 1001',
    );
    expect(mapped['sections.cadastral.phones']).toHaveLength(2);
    expect(mapped['sections.cadastral.emails']).toHaveLength(1);
    expect(mapped['sections.cadastral.vehicles']).toHaveLength(2);
    expect(mapped['sections.corporateStructure.qsa']).toHaveLength(1);
    expect((mapped['sections.corporateStructure.qsa'] as { name: string }[])[0].name).toBe(
      'JOAO SILVA',
    );
    expect(
      (mapped['sections.corporateStructure.qsa'] as { sharePercent: number }[])[0].sharePercent,
    ).toBe(100);
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
    expect(mapped['sections.litigation.lawsuits']).toHaveLength(1);
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
