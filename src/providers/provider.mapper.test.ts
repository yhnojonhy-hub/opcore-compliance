import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyFieldMappings } from './provider.mapper.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, name), 'utf-8'));
}

const brasilapiCnpjMappings = [
  { source: '$.razao_social', target: 'sections.cadastral.legalName' },
  { source: '$.nome_fantasia', target: 'sections.cadastral.tradeName' },
  { source: '$.descricao_situacao_cadastral', target: 'sections.cadastral.cnpjStatus' },
  { source: '$.data_inicio_atividade', target: 'sections.cadastral.openingDate' },
  { source: '$.cnae_fiscal', target: 'sections.cadastral.cnae' },
  { source: '$.qsa', target: 'sections.corporateStructure.qsa' },
];

const brasilapiCpfMappings = [{ source: '$.isValid', target: 'sections.cadastral.cpfRegular' }];

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
    const raw = loadFixture('brasilapi-cnpj-response.json');
    const mapped = applyFieldMappings(raw, brasilapiCnpjMappings);

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
    const raw = loadFixture('brasilapi-cpf-response.json');
    const mapped = applyFieldMappings(raw, brasilapiCpfMappings);

    expect(mapped['sections.cadastral.cpfRegular']).toBe(true);
  });
});
