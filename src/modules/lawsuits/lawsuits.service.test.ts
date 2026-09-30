import { describe, expect, it, vi } from 'vitest';

vi.mock('../../db/prisma.js', () => ({ prisma: {} }));

const { searchLawsuit, extractLawsuits, InvalidLawsuitNumberError } =
  await import('./lawsuits.service.js');

const NUMBER = '1001637-88.2023.8.26.0704';
const DIGITS = '10016378820238260704';
const CNPJ = '34258765000148';
const CPF = '52998224725';

function bdc(wrapper: 'Lawsuits' | 'Processes', lawsuits: unknown[]) {
  return { Result: [{ [wrapper]: { Lawsuits: lawsuits, TotalLawsuits: lawsuits.length } }] };
}

const lawsuit = {
  Number: DIGITS,
  Type: 'EXECUCAO DE TITULO EXTRAJUDICIAL',
  CourtName: 'TJSP',
  CourtLevel: '1',
  CourtDistrict: 'SAO PAULO',
  JudgingBody: '3 VARA CIVEL',
  Judge: 'FULANO',
  Status: 'ATIVO',
  Value: 234188.88,
  NoticeDate: '2023-03-02T00:00:00',
  LastMovementDate: '2026-09-04T00:00:00',
  CloseDate: '0001-01-01T00:00:00',
  LastUpdate: '2026-09-05T00:00:00',
  Parties: [{ Doc: CNPJ, Name: 'EMPRESA', Type: 'CLAIMANT', Polarity: 'ACTIVE', PartyDetails: {} }],
  Updates: [
    {
      Content: 'INTIME-SE O EXECUTADO PARA PAGAR NO PRAZO DE 15 (QUINZE) DIAS',
      PublishDate: '2026-09-04T00:00:00',
    },
  ],
  Decisions: [{ DecisionDate: '2026-08-01T00:00:00', DecisionContent: 'DEFIRO A PENHORA' }],
  Petitions: [{ Type: 'PETICAO INTERMEDIARIA', CreationDate: '2026-07-01T00:00:00' }],
};

function consultWith(raws: Record<string, unknown>) {
  return vi.fn(async ({ document }: { document: string }) => {
    const raw = raws[document];
    if (raw instanceof Error) throw raw;
    return { rawPayload: raw } as never;
  });
}

describe('extractLawsuits', () => {
  it('lê os dois formatos de resposta da BigDataCorp', () => {
    expect(extractLawsuits(bdc('Lawsuits', [lawsuit]))).toHaveLength(1);
    expect(extractLawsuits(bdc('Processes', [lawsuit]))).toHaveLength(1);
    expect(extractLawsuits(null)).toEqual([]);
  });
});

describe('searchLawsuit', () => {
  it('acha o processo pelo número entre os processos das partes e junta andamentos', async () => {
    const consult = consultWith({
      [CNPJ]: bdc('Lawsuits', [{ ...lawsuit, Number: '00000000000000000000' }, lawsuit]),
      [CPF]: bdc('Processes', []),
    });
    const result = await searchLawsuit(
      {
        number: NUMBER,
        documents: [
          { document: CNPJ, documentType: 'CNPJ' },
          { document: CPF, documentType: 'CPF' },
        ],
      },
      { consult },
    );

    expect(consult).toHaveBeenCalledWith(
      expect.objectContaining({ providerSlug: 'bigdatacorp-pj-processes', includeRaw: true }),
    );
    expect(consult).toHaveBeenCalledWith(
      expect.objectContaining({ providerSlug: 'bigdatacorp-pf-processes' }),
    );
    expect(result.found).toBe(true);
    expect(result.court).toBe('TJSP');
    expect(result.judgingBody).toBe('3 VARA CIVEL');
    expect(result.amount).toBe(234188.88);
    expect(result.closeDate).toBeNull();
    expect(result.movements.map((m) => m.kind)).toEqual(['update', 'decision', 'petition']);
    expect(result.movements[0].id).toMatch(/^[0-9a-f]{24}$/);
    expect(result.sources).toEqual([
      { document: '34258765/****', documentType: 'CNPJ', status: 'ok' },
      {
        document: '***.982.***-**',
        documentType: 'CPF',
        status: 'not_found',
        detail: '0 processo(s) do documento, nenhum com este número',
      },
    ]);
  });

  it('deduplica andamentos repetidos entre documentos e ignora valor -1', async () => {
    const consult = consultWith({
      [CNPJ]: bdc('Lawsuits', [{ ...lawsuit, Value: -1 }]),
      [CPF]: bdc('Processes', [{ ...lawsuit, Value: -1 }]),
    });
    const result = await searchLawsuit(
      {
        number: DIGITS,
        documents: [
          { document: CNPJ, documentType: 'CNPJ' },
          { document: CPF, documentType: 'CPF' },
        ],
      },
      { consult },
    );
    expect(result.movements).toHaveLength(3);
    expect(result.amount).toBeNull();
  });

  it('não encontrado e falha de fonte viram relatório por documento', async () => {
    const consult = consultWith({ [CNPJ]: new Error('BigDataCorp 500') });
    const result = await searchLawsuit(
      { number: DIGITS, documents: [{ document: CNPJ, documentType: 'CNPJ' }] },
      { consult },
    );
    expect(result.found).toBe(false);
    expect(result.movements).toEqual([]);
    expect(result.sources[0]).toMatchObject({ status: 'error', detail: 'BigDataCorp 500' });
  });

  it('rejeita número fora do padrão CNJ', async () => {
    await expect(
      searchLawsuit({ number: '123', documents: [] }, { consult: vi.fn() }),
    ).rejects.toBeInstanceOf(InvalidLawsuitNumberError);
  });
});
