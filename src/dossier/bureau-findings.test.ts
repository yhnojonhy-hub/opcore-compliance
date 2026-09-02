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
});
