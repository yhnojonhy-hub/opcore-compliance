import { describe, expect, it } from 'vitest';
import { emptyPjSections } from '../contracts/types/compliance-dossier.types.js';
import { mergeMappedIntoSectionsIncremental } from './section-merge.js';

const ctx = (priority: number, iso: string, slug = 'provider-a') => ({
  priority,
  consultedAt: new Date(iso),
  providerSlug: slug,
});

describe('mergeMappedIntoSectionsIncremental', () => {
  it('fills empty fields from later consultations', () => {
    const sections = emptyPjSections() as unknown as Record<string, Record<string, unknown>>;

    mergeMappedIntoSectionsIncremental(
      { 'sections.cadastral.legalName': 'OLD NAME' },
      sections,
      ctx(10, '2026-01-01T00:00:00Z'),
    );
    mergeMappedIntoSectionsIncremental(
      { 'sections.cadastral.tradeName': 'TRADE' },
      sections,
      ctx(10, '2026-01-02T00:00:00Z'),
    );

    expect(sections.cadastral.legalName).toBe('OLD NAME');
    expect(sections.cadastral.tradeName).toBe('TRADE');
  });

  it('does not let older consultation overwrite newer scalar', () => {
    const sections = emptyPjSections() as unknown as Record<string, Record<string, unknown>>;

    mergeMappedIntoSectionsIncremental(
      { 'sections.cadastral.legalName': 'NEW NAME' },
      sections,
      ctx(10, '2026-01-02T00:00:00Z'),
    );
    mergeMappedIntoSectionsIncremental(
      { 'sections.cadastral.legalName': 'OLD NAME' },
      sections,
      ctx(10, '2026-01-01T00:00:00Z'),
    );

    expect(sections.cadastral.legalName).toBe('NEW NAME');
  });

  it('prefers lower provider priority number on scalar conflict', () => {
    const sections = emptyPjSections() as unknown as Record<string, Record<string, unknown>>;

    mergeMappedIntoSectionsIncremental(
      { 'sections.cadastral.legalName': 'LEMIT NAME' },
      sections,
      ctx(20, '2026-01-01T00:00:00Z', 'lemit-cnpj'),
    );
    mergeMappedIntoSectionsIncremental(
      { 'sections.cadastral.legalName': 'BDC NAME' },
      sections,
      ctx(10, '2026-01-01T00:00:00Z', 'bigdatacorp-cnpj'),
    );

    expect(sections.cadastral.legalName).toBe('BDC NAME');
  });

  it('never lets Lemit overwrite BigDataCorp fullName', () => {
    const sections = emptyPjSections() as unknown as Record<string, Record<string, unknown>>;

    mergeMappedIntoSectionsIncremental(
      { 'sections.cadastral.legalName': 'BDC NAME' },
      sections,
      ctx(10, '2026-01-01T00:00:00Z', 'bigdatacorp-cnpj'),
    );
    mergeMappedIntoSectionsIncremental(
      { 'sections.cadastral.legalName': 'LEMIT NAME' },
      sections,
      ctx(20, '2026-01-02T00:00:00Z', 'lemit-cnpj'),
    );

    expect(sections.cadastral.legalName).toBe('BDC NAME');
  });

  it('lets Lemit fill protests when BDC has no value', () => {
    const sections = emptyPjSections() as unknown as Record<string, Record<string, unknown>>;

    mergeMappedIntoSectionsIncremental(
      { 'sections.cadastral.legalName': 'BDC NAME' },
      sections,
      ctx(10, '2026-01-01T00:00:00Z', 'bigdatacorp-cnpj'),
    );
    mergeMappedIntoSectionsIncremental(
      {
        'sections.fiscalHealth.protests': [{ amount: 100, status: 'ativo' }],
      },
      sections,
      ctx(20, '2026-01-02T00:00:00Z', 'lemit-cnpj'),
    );

    expect(sections.cadastral.legalName).toBe('BDC NAME');
    expect(sections.fiscalHealth.protests).toHaveLength(1);
  });

  it('concatenates and deduplicates arrays', () => {
    const sections = emptyPjSections() as unknown as Record<string, Record<string, unknown>>;

    mergeMappedIntoSectionsIncremental(
      {
        'sections.sanctions.internationalHits': [
          { name: 'Hit A', document: '111' },
          { name: 'Hit B', document: '222' },
        ],
      },
      sections,
      ctx(10, '2026-01-01T00:00:00Z'),
    );
    mergeMappedIntoSectionsIncremental(
      {
        'sections.sanctions.internationalHits': [
          { name: 'Hit B', document: '222' },
          { name: 'Hit C', document: '333' },
        ],
      },
      sections,
      ctx(10, '2026-01-02T00:00:00Z'),
    );

    const hits = sections.sanctions.internationalHits as { document: string }[];
    expect(hits).toHaveLength(3);
    expect(hits.map((h) => h.document)).toEqual(['111', '222', '333']);
  });

  it('deduplicates lawsuits by case number', () => {
    const sections = emptyPjSections() as unknown as Record<string, Record<string, unknown>>;

    mergeMappedIntoSectionsIncremental(
      {
        'sections.litigationEsg.lawsuits': [
          { caseNumber: '0001234-56.2024.8.26.0100', court: 'TJSP' },
        ],
      },
      sections,
      ctx(10, '2026-01-01T00:00:00Z', 'bigdatacorp-cpf'),
    );
    mergeMappedIntoSectionsIncremental(
      {
        'sections.litigationEsg.lawsuits': [
          { caseNumber: '00012345620248260100', court: 'DataJud' },
          { caseNumber: '9999999-00.2023.8.26.0100', court: 'TJSP' },
        ],
      },
      sections,
      ctx(50, '2026-01-02T00:00:00Z', 'osint-datajud'),
    );

    const lawsuits = sections.litigationEsg.lawsuits as { caseNumber: string }[];
    expect(lawsuits).toHaveLength(2);
  });

  it('merges qsa arrays without duplicates', () => {
    const sections = emptyPjSections() as unknown as Record<string, Record<string, unknown>>;

    mergeMappedIntoSectionsIncremental(
      {
        'sections.corporateStructure.qsa': [{ name: 'Alice', role: 'Sócia', document: '111' }],
      },
      sections,
      ctx(10, '2026-01-01T00:00:00Z'),
    );
    mergeMappedIntoSectionsIncremental(
      {
        'sections.corporateStructure.qsa': [
          { name: 'Alice', role: 'Sócia', document: '111' },
          { name: 'Bob', role: 'Sócio', document: '222' },
        ],
      },
      sections,
      ctx(10, '2026-01-02T00:00:00Z'),
    );

    const qsa = sections.corporateStructure.qsa as { name: string }[];
    expect(qsa).toHaveLength(2);
  });
});
