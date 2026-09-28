import { describe, expect, it, vi } from 'vitest';
import type { DataJudByNumberResult } from '../../providers/adapters/datajud/by-number.js';

vi.mock('../../db/prisma.js', () => ({ prisma: {} }));
vi.mock('../compliance/dossier.service.js', () => ({ buildDossier: vi.fn() }));

const { lookupLawsuit, normalizeLookupDocuments, InvalidCnjError } =
  await import('./lawsuits.service.js');

const NUMBER = '5003495-02.2026.8.24.0037';
const DIGITS = '50034950220268240037';
const CPF = '52998224725';

const dataJudOk: DataJudByNumberResult = {
  status: 'ok',
  alias: 'tjsc',
  tribunal: 'TJSC',
  instances: [
    {
      alias: 'tjsc',
      degree: 'G1',
      organ: '2ª Vara Cível',
      className: 'Execução de Título Extrajudicial',
      subjects: ['Contratos Bancários'],
      filedAt: '2026-07-14T14:47:00Z',
      updatedAt: '2026-08-02T00:00:00Z',
      system: 'Eproc',
    },
  ],
  movements: [
    {
      id: 'm1',
      date: '2026-08-01T10:00:00.000Z',
      code: 11010,
      name: 'Mero expediente',
      degree: 'G1',
      complements: [],
      source: 'DataJud CNJ',
    },
  ],
};

function deps(overrides: Record<string, unknown> = {}) {
  return {
    searchDataJud: vi.fn().mockResolvedValue(dataJudOk),
    lawsuitsByDocument: vi.fn().mockResolvedValue([
      {
        court: 'TJSC',
        type: 'EXECUCAO',
        status: 'ATIVO',
        amount: 149054.8,
        caseNumber: NUMBER,
        source: 'BigDataCorp',
      },
      {
        court: 'TJSP',
        type: 'Cível',
        status: 'ARQUIVADO',
        amount: 10,
        caseNumber: '1000000-00.2020.8.26.0100',
      },
    ]),
    readCache: vi.fn().mockResolvedValue(null),
    writeCache: vi.fn().mockResolvedValue(undefined),
    now: () => new Date('2026-09-28T12:00:00Z'),
    ...overrides,
  };
}

describe('lookupLawsuit', () => {
  it('recusa número inválido', async () => {
    await expect(lookupLawsuit({ number: '123' }, deps())).rejects.toBeInstanceOf(InvalidCnjError);
  });

  it('junta DataJud e bureaus filtrando pelo número', async () => {
    const d = deps();
    const detail = await lookupLawsuit(
      { number: NUMBER, documents: [{ document: '529.982.247-25', documentType: 'CPF' }] },
      d,
    );
    expect(d.lawsuitsByDocument).toHaveBeenCalledWith(
      { document: CPF, documentType: 'CPF' },
      false,
    );
    expect(detail).toMatchObject({
      number: DIGITS,
      found: true,
      tribunal: 'TJSC',
      className: 'Execução de Título Extrajudicial',
      status: 'ATIVO',
      amount: 149054.8,
      type: 'EXECUCAO',
      organ: '2ª Vara Cível',
      lastUpdateAt: '2026-08-02T00:00:00Z',
      cached: false,
    });
    expect(detail.movements).toHaveLength(1);
    expect(detail.sources.map((s) => s.status)).toEqual(['ok', 'ok']);
    expect(d.writeCache).toHaveBeenCalledWith(
      DIGITS,
      expect.objectContaining({ documents: [CPF] }),
      true,
    );
  });

  it('marca bureaus como pulados sem documento válido', async () => {
    const detail = await lookupLawsuit(
      { number: NUMBER, documents: [{ document: '111.111.111-11', documentType: 'CPF' }] },
      deps(),
    );
    expect(detail.sources[1]).toMatchObject({ name: 'Bureaus OpCore', status: 'skipped' });
  });

  it('usa o cache quando cobre os documentos pedidos', async () => {
    const d = deps({
      readCache: vi.fn().mockResolvedValue({
        payload: { detail: { number: DIGITS, sources: [] }, documents: [CPF] },
        expiresAt: new Date('2026-09-28T13:00:00Z'),
      }),
    });
    const detail = await lookupLawsuit(
      { number: NUMBER, documents: [{ document: CPF, documentType: 'CPF' }] },
      d,
    );
    expect(detail.cached).toBe(true);
    expect(d.searchDataJud).not.toHaveBeenCalled();
  });

  it('ignora o cache com forceRefresh ou documento novo', async () => {
    const cache = vi.fn().mockResolvedValue({
      payload: { detail: { number: DIGITS, sources: [] }, documents: [] },
      expiresAt: new Date('2026-09-28T13:00:00Z'),
    });
    const d1 = deps({ readCache: cache });
    await lookupLawsuit(
      { number: NUMBER, documents: [{ document: CPF, documentType: 'CPF' }] },
      d1,
    );
    expect(d1.searchDataJud).toHaveBeenCalled();

    const d2 = deps({ readCache: cache });
    await lookupLawsuit({ number: NUMBER, forceRefresh: true }, d2);
    expect(cache).toHaveBeenCalledTimes(1);
    expect(d2.searchDataJud).toHaveBeenCalled();
  });

  it('não grava cache quando todas as fontes falham', async () => {
    const d = deps({
      searchDataJud: vi.fn().mockResolvedValue({ status: 'error', error: '429', httpStatus: 429 }),
    });
    const detail = await lookupLawsuit({ number: NUMBER }, d);
    expect(detail.found).toBe(false);
    expect(d.writeCache).not.toHaveBeenCalled();
  });

  it('reporta erro de um documento sem derrubar o resto', async () => {
    const d = deps({ lawsuitsByDocument: vi.fn().mockRejectedValue(new Error('BDC fora')) });
    const detail = await lookupLawsuit(
      { number: NUMBER, documents: [{ document: CPF, documentType: 'CPF' }] },
      d,
    );
    expect(detail.found).toBe(true);
    expect(detail.sources[1]).toMatchObject({ status: 'error', error: 'BDC fora' });
  });
});

describe('normalizeLookupDocuments', () => {
  it('remove inválidos e repetidos', () => {
    expect(
      normalizeLookupDocuments([
        { document: '529.982.247-25', documentType: 'CPF' },
        { document: CPF, documentType: 'CPF' },
        { document: '123', documentType: 'CNPJ' },
      ]),
    ).toEqual([{ document: CPF, documentType: 'CPF' }]);
  });
});
