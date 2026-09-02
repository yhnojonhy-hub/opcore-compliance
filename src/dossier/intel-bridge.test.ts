import { describe, expect, it } from 'vitest';
import type { ComplianceDossier } from '../contracts/types/compliance-dossier.types.js';
import type { Lawsuit } from '../contracts/types/canonical/shared.types.js';
import { findingsToSections } from './intel-bridge.js';

describe('intel-bridge canonical mapping', () => {
  it('maps lawsuit findings to litigation.lawsuits for CPF', () => {
    const sections = findingsToSections(
      [
        {
          id: '1',
          category: 'LAWSUIT',
          sourceName: 'DataJud',
          reliability: 'OFFICIAL',
          confidence: 90,
          title: 'Processo 123',
          summary: 'Cível',
          details: { numeroProcesso: '123', tribunal: 'TJSP' },
          verified: false,
        },
      ],
      'CPF',
    );

    expect(sections.litigation?.lawsuits).toHaveLength(1);
    expect((sections.litigation?.lawsuits as Lawsuit[])[0]).toMatchObject({
      court: 'TJSP',
      caseNumber: '123',
    });
  });
});
