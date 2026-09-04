import { describe, expect, it } from 'vitest';
import { normalizeContactsInMapped } from './contacts.normalizer.js';

describe('normalizeContactsInMapped', () => {
  it('merges mobile and landline phones and normalizes Lemit snake_case', () => {
    const mapped: Record<string, unknown> = {
      'sections.cadastral.mobilePhones': [
        { ddd: 11, numero: '999990000', ranking: 1, whatsapp: true, plus: true },
      ],
      'sections.cadastral.landlinePhones': [{ ddd: 11, numero: '33334444', ranking: 1 }],
      'sections.cadastral.emails': [{ email: 'a@b.com', ranking: 1, possui_cookie: true }],
      'sections.cadastral.addresses': {
        endereco: 'AV PAULISTA, 1001',
        cidade: 'SAO PAULO',
        uf: 'SP',
        cep: '01311000',
        tipo: 'comercial',
        ranking: 1,
      },
      'sections.cadastral.vehicles': [
        {
          placa: 'ZZZ99999',
          marca: 'VW/GOL',
          ano_fabricacao: 2007,
          ano_modelo: 2008,
          renavan: '123456789',
          chassi: 'AA00BBB22C3333333',
          ranking: 1,
        },
      ],
      'sections.corporateLinks.relatedPeople': [
        { cpf_vinculo: '88877766655', nome_vinculo: 'JESSICA', tipo_vinculo: 'MAE' },
      ],
      'sections.corporateLinks.shareholdings': [
        {
          nome: 'EMPRESA A',
          cnpj: '00999999000199',
          capital_social: 10000,
          participacao_socio: 50,
          situacao_cadastral: 'INAPTA',
        },
      ],
      'sections.financial.creditFlags': 'BAIXISSIMO RISCO',
      'sections.financial.financialRiskLevel': 'BAIXISSIMO RISCO',
    };

    normalizeContactsInMapped(mapped);

    expect(mapped['sections.cadastral.mobilePhones']).toBeUndefined();
    expect(mapped['sections.cadastral.landlinePhones']).toBeUndefined();
    expect(mapped['sections.cadastral.phones']).toEqual([
      {
        ddd: 11,
        number: '999990000',
        type: 'mobile',
        ranking: 1,
        whatsapp: true,
        plus: true,
      },
      {
        ddd: 11,
        number: '33334444',
        type: 'landline',
        ranking: 1,
        whatsapp: null,
        plus: null,
      },
    ]);
    expect(mapped['sections.cadastral.emails']).toEqual([
      { email: 'a@b.com', ranking: 1, hasCookie: true },
    ]);
    expect(mapped['sections.cadastral.addresses']).toHaveLength(1);
    expect((mapped['sections.cadastral.addresses'] as { line: string }[])[0].line).toBe(
      'AV PAULISTA, 1001',
    );
    expect((mapped['sections.cadastral.vehicles'] as { renavam: string }[])[0].renavam).toBe(
      '123456789',
    );
    expect(mapped['sections.corporateLinks.relatedPeople']).toEqual([
      { document: '88877766655', name: 'JESSICA', relationType: 'MAE' },
    ]);
    expect(mapped['sections.corporateLinks.shareholdings']).toEqual([
      {
        name: 'EMPRESA A',
        document: '00999999000199',
        capital: 10000,
        sharePercent: 50,
        foundedDate: null,
        cadastralStatus: 'INAPTA',
      },
    ]);
    expect(mapped['sections.financial.creditFlags']).toEqual(['BAIXISSIMO RISCO']);
  });
});
