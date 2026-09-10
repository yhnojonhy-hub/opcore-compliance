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

  it('merges Apollo IDENTITY emails/phones into cadastral', () => {
    const sections = findingsToSections(
      [
        {
          id: 'a1',
          category: 'IDENTITY',
          sourceName: 'Apollo.io',
          reliability: 'PAID',
          confidence: 88,
          title: 'Maria Silva',
          summary: 'CEO · maria@indexcore.com.br',
          details: {
            email: 'maria@indexcore.com.br',
            phone: '+5511999998888',
            emails: [{ email: 'maria@indexcore.com.br', ranking: 1, hasCookie: null }],
            phones: [{ number: '+5511999998888', ddd: null, type: null }],
          },
          verified: false,
        },
      ],
      'CPF',
    );

    expect(sections.cadastral?.fullName).toBe('Maria Silva');
    expect(sections.cadastral?.emails).toEqual(
      expect.arrayContaining([expect.objectContaining({ email: 'maria@indexcore.com.br' })]),
    );
    expect(sections.cadastral?.phones).toEqual(
      expect.arrayContaining([expect.objectContaining({ number: '+5511999998888' })]),
    );
  });

  it('maps Apollo SOCIAL_PRESENCE to corporateLinks.companies', () => {
    const sections = findingsToSections(
      [
        {
          id: 'a2',
          category: 'SOCIAL_PRESENCE',
          sourceName: 'Apollo.io',
          reliability: 'PAID',
          confidence: 80,
          title: 'LinkedIn · Maria Silva',
          summary: 'CEO · INDEX CORE',
          details: {
            linkedinUrl: 'https://www.linkedin.com/in/mariasilva',
            organizationName: 'INDEX CORE',
            organizationDomain: 'indexcore.com.br',
          },
          url: 'https://www.linkedin.com/in/mariasilva',
          verified: false,
        },
      ],
      'CNPJ',
    );

    expect(sections.corporateLinks?.companies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          linkedinUrl: 'https://www.linkedin.com/in/mariasilva',
          name: 'INDEX CORE',
          domain: 'indexcore.com.br',
        }),
      ]),
    );
  });
});
