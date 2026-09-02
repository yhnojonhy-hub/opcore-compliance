import { describe, expect, it } from 'vitest';
import {
  coerceLawsuitRows,
  normalizeLawsuitItem,
  normalizeLawsuitList,
  normalizeLawsuitsInMapped,
} from './lawsuit.normalizer.js';

describe('lawsuit.normalizer', () => {
  it('unwraps BigDataCorp Processes.Lawsuits wrapper', () => {
    const rows = coerceLawsuitRows({
      Lawsuits: [{ Number: '0001', CourtName: 'TJSP', Status: 'ATIVO' }],
      TotalLawsuits: 1,
    });
    expect(rows).toHaveLength(1);
  });

  it('maps BigDataCorp PascalCase lawsuit fields', () => {
    const lawsuit = normalizeLawsuitItem({
      Number: '0001234-56.2024.8.26.0100',
      Type: 'PROCEDIMENTO COMUM CÍVEL',
      CourtName: 'TJSP',
      Status: 'EM ANDAMENTO',
      NoticeDate: '2024-03-10T00:00:00',
      Value: 15000,
    });

    expect(lawsuit).toMatchObject({
      caseNumber: '0001234-56.2024.8.26.0100',
      court: 'TJSP',
      type: 'PROCEDIMENTO COMUM CÍVEL',
      status: 'EM ANDAMENTO',
      amount: 15000,
      filedAt: '2024-03-10T00:00:00',
    });
  });

  it('normalizes mapped Processes wrapper into lawsuits array', () => {
    const mapped: Record<string, unknown> = {
      'sections.litigation.lawsuits': {
        Lawsuits: [
          {
            Number: '999',
            CourtName: 'TJRJ',
            Type: 'CÍVEL',
            Status: 'ARQUIVADO',
          },
        ],
      },
    };
    normalizeLawsuitsInMapped(mapped);
    const lawsuits = mapped['sections.litigation.lawsuits'] as ReturnType<
      typeof normalizeLawsuitList
    >;
    expect(lawsuits).toHaveLength(1);
    expect(lawsuits[0].caseNumber).toBe('999');
    expect(lawsuits[0].court).toBe('TJRJ');
  });
});
