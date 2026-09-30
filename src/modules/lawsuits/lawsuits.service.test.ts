import { describe, expect, it, vi } from 'vitest';
import type { DataJudByNumberResult } from './datajud-by-number.js';

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
  State: 'SP',
  JudgingBody: '3 VARA CIVEL',
  Judge: 'FULANO',
  Status: 'ATIVO',
  Value: 234188.88,
  NoticeDate: '2023-03-02T00:00:00',
  LastMovementDate: '2026-06-10T00:00:00',
  CloseDate: '0001-01-01T00:00:00',
  LastUpdate: '2026-08-05T00:00:00',
  Parties: [{ Doc: CNPJ, Name: 'EMPRESA', Type: 'CLAIMANT', Polarity: 'ACTIVE', PartyDetails: {} }],
  Updates: [
    {
      Content: 'INTIME-SE O EXECUTADO PARA PAGAR NO PRAZO DE 15 (QUINZE) DIAS',
      PublishDate: '2026-06-10T00:00:00',
    },
  ],
  Decisions: [{ DecisionDate: '2026-06-01T00:00:00', DecisionContent: 'DEFIRO A PENHORA' }],
  Petitions: [{ Type: 'PETICAO INTERMEDIARIA', CreationDate: '2026-05-01T00:00:00' }],
};

const dataJudOk: DataJudByNumberResult = {
  status: 'ok',
  lawsuit: {
    alias: 'tjsp',
    tribunal: 'TJSP',
    className: 'Execução de Título Extrajudicial',
    judgingBody: 'Juízo Titular I - 3ª Vara Cível - Regional XV - Butantã',
    cityIbgeCode: '3550308',
    degree: 'G1',
    subject: 'Espécies de Títulos de Crédito',
    filedAt: '2023-03-02T17:01:31.000Z',
    movements: [
      { id: 'dj1', date: '2026-09-04T14:47:03.000Z', content: 'Conclusão - para decisão' },
    ],
  },
};

const dataJudMissing: DataJudByNumberResult = {
  status: 'not_found',
  alias: 'tjsp',
  detail: 'não encontrado em TJSP',
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
  it('junta BigDataCorp das partes e DataJud pelo número', async () => {
    const consult = consultWith({
      [CNPJ]: bdc('Lawsuits', [{ ...lawsuit, Number: '00000000000000000000' }, lawsuit]),
      [CPF]: bdc('Processes', []),
    });
    const dataJud = vi.fn().mockResolvedValue(dataJudOk);
    const result = await searchLawsuit(
      {
        number: NUMBER,
        documents: [
          { document: CNPJ, documentType: 'CNPJ' },
          { document: CPF, documentType: 'CPF' },
        ],
        forceRefresh: true,
      },
      { consult, dataJud },
    );

    expect(dataJud).toHaveBeenCalledWith(DIGITS);
    expect(consult).toHaveBeenCalledWith(
      expect.objectContaining({
        providerSlug: 'bigdatacorp-pj-processes',
        includeRaw: true,
        forceRefresh: true,
      }),
    );
    expect(consult).toHaveBeenCalledWith(
      expect.objectContaining({ providerSlug: 'bigdatacorp-pf-processes' }),
    );
    expect(result.found).toBe(true);
    expect(result.court).toBe('TJSP');
    expect(result.judgingBody).toBe('3 VARA CIVEL');
    expect(result.cityIbgeCode).toBe('3550308');
    expect(result.amount).toBe(234188.88);
    expect(result.closeDate).toBeNull();
    expect(result.lastMovementDate).toBe('2026-09-04T14:47:03.000Z');
    expect(result.movements.map((m) => [m.kind, m.source])).toEqual([
      ['court_movement', 'DataJud CNJ'],
      ['update', 'BigDataCorp'],
      ['decision', 'BigDataCorp'],
      ['petition', 'BigDataCorp'],
    ]);
    expect(result.sources).toEqual([
      { name: 'BigDataCorp (CNPJ 34258765/****)', status: 'ok' },
      {
        name: 'BigDataCorp (CPF ***.982.***-**)',
        status: 'not_found',
        detail: '0 processo(s) do documento, nenhum com este número',
      },
      { name: 'DataJud CNJ (TJSP)', status: 'ok', detail: '1 movimento(s)' },
    ]);
  });

  it('só o DataJud encontra: dados do tribunal e UF pelo índice', async () => {
    const consult = consultWith({ [CNPJ]: bdc('Lawsuits', []) });
    const result = await searchLawsuit(
      { number: DIGITS, documents: [{ document: CNPJ, documentType: 'CNPJ' }] },
      { consult, dataJud: async () => dataJudOk },
    );
    expect(result.found).toBe(true);
    expect(result.court).toBe('TJSP');
    expect(result.state).toBe('SP');
    expect(result.type).toBe('Execução de Título Extrajudicial');
    expect(result.movements).toHaveLength(1);
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
      { consult, dataJud: async () => dataJudMissing },
    );
    expect(result.movements).toHaveLength(3);
    expect(result.amount).toBeNull();
    expect(result.cityIbgeCode).toBeNull();
  });

  it('nenhuma fonte encontra: relatório por fonte', async () => {
    const consult = consultWith({ [CNPJ]: new Error('BigDataCorp 500') });
    const result = await searchLawsuit(
      { number: DIGITS, documents: [{ document: CNPJ, documentType: 'CNPJ' }] },
      { consult, dataJud: vi.fn().mockRejectedValue(new Error('rede')) },
    );
    expect(result.found).toBe(false);
    expect(result.movements).toEqual([]);
    expect(result.sources).toEqual([
      { name: 'BigDataCorp (CNPJ 34258765/****)', status: 'error', detail: 'BigDataCorp 500' },
      { name: 'DataJud CNJ', status: 'error', detail: 'rede' },
    ]);
  });

  it('rejeita número fora do padrão CNJ', async () => {
    await expect(
      searchLawsuit({ number: '123', documents: [] }, { consult: vi.fn(), dataJud: vi.fn() }),
    ).rejects.toBeInstanceOf(InvalidLawsuitNumberError);
  });
});
