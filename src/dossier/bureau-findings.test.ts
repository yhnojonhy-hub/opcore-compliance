import { describe, expect, it } from 'vitest';
import {
  bureauConsultationsToFindings,
  extractPartyNameFromConsultations,
} from './bureau-findings.js';

describe('bureau-findings', () => {
  it('extracts partyName preferring BigDataCorp over Lemit', () => {
    const name = extractPartyNameFromConsultations(
      [
        {
          provider: 'lemit-cpf',
          payload: { sections: { cadastral: { fullName: 'NOME LEMIT' } } },
        },
        {
          provider: 'bigdatacorp-cpf',
          payload: { sections: { cadastral: { fullName: 'NOME BDC' } } },
        },
      ],
      'CPF',
    );
    expect(name).toBe('NOME BDC');
  });

  it('projects IDENTITY and LAWSUIT findings from BDC sections', () => {
    const findings = bureauConsultationsToFindings(
      [
        {
          provider: 'bigdatacorp-cpf',
          payload: {
            sections: {
              cadastral: { fullName: 'FULANO DE TAL', cpfStatus: 'REGULAR' },
              litigation: {
                lawsuits: [
                  {
                    caseNumber: '0001234-56.2024.8.26.0100',
                    court: 'TJSP',
                    type: 'CÍVEL',
                    status: 'EM ANDAMENTO',
                  },
                ],
              },
            },
          },
        },
      ],
      'CPF',
    );

    expect(findings.some((f) => f.category === 'IDENTITY' && f.title === 'FULANO DE TAL')).toBe(
      true,
    );
    expect(findings.some((f) => f.category === 'LAWSUIT')).toBe(true);
  });
});
