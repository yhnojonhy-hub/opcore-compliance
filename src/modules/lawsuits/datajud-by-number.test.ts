import { describe, expect, it, vi } from 'vitest';
import { dataJudAliasForNumber, searchDataJudByNumber } from './datajud-by-number.js';

const DIGITS = '10016378820238260704';

const hit = {
  _id: 'TJSP_G1_1',
  _source: {
    tribunal: 'TJSP',
    grau: 'G1',
    classe: { nome: 'Execução de Título Extrajudicial' },
    orgaoJulgador: { nome: '3ª Vara Cível', codigoMunicipioIBGE: 3550308 },
    assuntos: [{ nome: 'Espécies de Títulos de Crédito' }],
    dataAjuizamento: '20230302170131',
    dataHoraUltimaAtualizacao: '2026-09-10T23:54:51.364Z',
    movimentos: [
      {
        codigo: 51,
        nome: 'Conclusão',
        dataHora: '2026-09-04T14:47:03.000Z',
        complementosTabelados: [{ nome: 'para decisão', descricao: 'tipo_de_conclusao' }],
      },
      { codigo: 26, nome: 'Distribuição', dataHora: '2023-03-02T17:01:31.000Z' },
    ],
  },
};

function response(status: number, json: unknown = null) {
  return { ok: status >= 200 && status < 300, status, json, text: '' };
}

describe('dataJudAliasForNumber', () => {
  it('estadual, federal e sem índice', () => {
    expect(dataJudAliasForNumber(DIGITS)).toBe('tjsp');
    expect(dataJudAliasForNumber('50162363120248080024')).toBe('tjes');
    expect(dataJudAliasForNumber('00000000020244030000')).toBe('trf3');
    expect(dataJudAliasForNumber('00000000020245020000')).toBe('trt2');
    expect(dataJudAliasForNumber('00000000020247010000')).toBeNull();
    expect(dataJudAliasForNumber('123')).toBeNull();
  });
});

describe('searchDataJudByNumber', () => {
  it('lê tribunal, município IBGE e movimentos com complementos', async () => {
    const fetchJson = vi.fn().mockResolvedValue(response(200, { hits: { hits: [hit] } }));
    const result = await searchDataJudByNumber(DIGITS, { fetchJson, apiKey: 'k' });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.lawsuit).toMatchObject({
      alias: 'tjsp',
      tribunal: 'TJSP',
      cityIbgeCode: '3550308',
      filedAt: '2023-03-02T17:01:31Z',
    });
    expect(result.lawsuit.movements.map((m) => m.content)).toEqual([
      'Conclusão - para decisão',
      'Distribuição',
    ]);
  });

  it('tenta de novo uma vez em 429 e reporta o erro', async () => {
    const fetchJson = vi.fn().mockResolvedValue(response(429));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const result = await searchDataJudByNumber(DIGITS, { fetchJson, sleep, apiKey: 'k' });
    expect(fetchJson).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ status: 'error', detail: expect.stringContaining('429') });
  });

  it('não encontrado e sem chave', async () => {
    const fetchJson = vi.fn().mockResolvedValue(response(200, { hits: { hits: [] } }));
    expect(await searchDataJudByNumber(DIGITS, { fetchJson, apiKey: 'k' })).toMatchObject({
      status: 'not_found',
    });
    expect(await searchDataJudByNumber(DIGITS, { fetchJson, apiKey: '' })).toMatchObject({
      status: 'skipped',
    });
  });
});
