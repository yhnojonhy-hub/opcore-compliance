import { describe, expect, it } from 'vitest';
import { bureauConsultationsToFindings } from './bureau-findings.js';

describe('bureauConsultationsToFindings absences', () => {
  it('emits consulted-absent findings when source ok with no material hits', () => {
    const findings = bureauConsultationsToFindings(
      [
        {
          provider: 'bigdatacorp-pf-basic_data',
          payload: {
            sections: {
              cadastral: { fullName: 'MARIA' },
              litigation: { lawsuits: [] },
              pldft: {},
            },
          },
        },
      ],
      'CPF',
      { emitAbsences: true },
    );

    expect(findings.some((f) => f.category === 'IDENTITY' && f.title === 'MARIA')).toBe(true);
    const absent = findings.filter(
      (f) => (f.details as { consultedAbsent?: boolean }).consultedAbsent,
    );
    expect(absent.length).toBeGreaterThan(0);
    expect(
      absent.every(
        (f) =>
          f.title.includes('Consultado — nada consta') || f.title.includes('Consultado — Serasa'),
      ),
    ).toBe(true);
  });

  it('does not emit absences when emitAbsences is false', () => {
    const findings = bureauConsultationsToFindings(
      [
        {
          provider: 'lemit-cpf',
          payload: { sections: { cadastral: { fullName: 'MARIA' } } },
        },
      ],
      'CPF',
      { emitAbsences: false },
    );
    expect(
      findings.every((f) => !(f.details as { consultedAbsent?: boolean }).consultedAbsent),
    ).toBe(true);
  });

  it('emits Lemit contact, vehicle, shareholding and credit findings as PAID', () => {
    const findings = bureauConsultationsToFindings(
      [
        {
          provider: 'lemit-cpf',
          payload: {
            sections: {
              cadastral: {
                fullName: 'JOAO SILVA',
                cpfStatus: 'REGULAR',
                phones: [{ ddd: 11, number: '999990000', type: 'mobile' }],
                emails: [{ email: 'a@b.com' }],
                addresses: [{ line: 'AV PAULISTA', city: 'SAO PAULO' }],
                vehicles: [{ plate: 'ZZZ99999', makeModel: 'VW/GOL' }],
              },
              corporateLinks: {
                relatedPeople: [{ name: 'MARIA', relationType: 'MAE' }],
                shareholdings: [{ name: 'EMPRESA A', sharePercent: 50 }],
              },
              financial: {
                creditFlags: ['BAIXISSIMO RISCO'],
                financialRiskLevel: 'BAIXISSIMO RISCO',
                estimatedIncome: 788,
              },
            },
          },
        },
      ],
      'CPF',
      { emitAbsences: false },
    );

    expect(findings.every((f) => f.reliability === 'PAID')).toBe(true);
    expect(findings.some((f) => f.title === 'JOAO SILVA')).toBe(true);
    expect(findings.some((f) => f.title === 'Contatos cadastrais')).toBe(true);
    expect(findings.some((f) => f.title.includes('veículo'))).toBe(true);
    expect(findings.some((f) => f.title.includes('vínculo'))).toBe(true);
    expect(findings.some((f) => f.title.includes('participação'))).toBe(true);
    expect(findings.some((f) => f.title.includes('risco financeiro'))).toBe(true);
    expect(findings.some((f) => f.title === 'Renda estimada')).toBe(true);
  });

  it('Lemit pillar absences skip lawsuit/PEP/Serasa and only cover catalog gaps', () => {
    const findings = bureauConsultationsToFindings(
      [
        {
          provider: 'lemit-cpf',
          payload: {
            sections: {
              cadastral: { fullName: 'MARIA SILVA', cpfStatus: 'REGULAR' },
            },
          },
        },
      ],
      'CPF',
      { pillarLabel: 'Lemit', emitAbsences: true },
    );

    const absent = findings.filter(
      (f) => (f.details as { consultedAbsent?: boolean }).consultedAbsent,
    );
    expect(findings.some((f) => f.title === 'MARIA SILVA')).toBe(true);
    expect(absent.some((f) => f.title.includes('contatos cadastrais'))).toBe(true);
    expect(absent.some((f) => f.title.includes('processos judiciais'))).toBe(false);
    expect(absent.some((f) => f.title.includes('sanções'))).toBe(false);
    expect(absent.some((f) => f.title.includes('PEP'))).toBe(false);
    expect(absent.some((f) => f.title.includes('protestos'))).toBe(false);
    expect(absent.some((f) => f.title.includes('Serasa'))).toBe(false);
  });
});
