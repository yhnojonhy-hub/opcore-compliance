import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseCnj } from '../../../lib/cnj.js';
import { resetIntelEnvCache } from '../../../lib/intel-env.js';
import { searchDataJudByNumber } from './by-number.js';

const cnj = parseCnj('5003495-02.2026.8.24.0037')!;

const hit = (grau: string, movimentos: unknown[]) => ({
  _id: `TJSC_${grau}`,
  _source: {
    numeroProcesso: cnj.digits,
    tribunal: 'TJSC',
    grau,
    dataAjuizamento: '20260714144700',
    classe: { codigo: 12154, nome: 'Execução de Título Extrajudicial' },
    assuntos: [{ codigo: 7691, nome: 'Contratos Bancários' }],
    orgaoJulgador: { nome: '2ª Vara Cível de Joinville' },
    sistema: { nome: 'Eproc' },
    movimentos,
  },
});

const ok = (hits: unknown[]) => ({ ok: true, status: 200, json: { hits: { hits } }, text: '' });
const fail = (status: number) => ({ ok: false, status, json: null, text: '' });

describe('searchDataJudByNumber', () => {
  beforeEach(() => {
    process.env.DATAJUD_API_KEY = 'test-key';
    resetIntelEnvCache();
  });
  afterEach(() => {
    delete process.env.DATAJUD_API_KEY;
    resetIntelEnvCache();
  });

  it('consulta o tribunal do número e junta movimentos das instâncias', async () => {
    const fetchJson = vi.fn().mockResolvedValue(
      ok([
        hit('G1', [
          { codigo: 26, nome: 'Distribuição', dataHora: '2026-07-14T14:47:00.000Z' },
          {
            codigo: 11010,
            nome: 'Mero expediente',
            dataHora: '2026-08-01T10:00:00.000Z',
            complementosTabelados: [{ codigo: 5, nome: 'prazo', valor: 15, descricao: 'dias' }],
          },
        ]),
        hit('G2', [{ codigo: 26, nome: 'Distribuição', dataHora: '2026-07-14T14:47:00.000Z' }]),
      ]),
    );

    const result = await searchDataJudByNumber(cnj, { fetchJson, sleep: async () => {} });

    expect(fetchJson.mock.calls[0][0]).toContain('api_publica_tjsc');
    expect(JSON.parse(fetchJson.mock.calls[0][1].body)).toMatchObject({
      query: { match: { numeroProcesso: cnj.digits } },
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.instances).toHaveLength(2);
    expect(result.instances[0]).toMatchObject({
      className: 'Execução de Título Extrajudicial',
      subjects: ['Contratos Bancários'],
      filedAt: '2026-07-14T14:47:00Z',
    });
    expect(result.movements.map((m) => m.code)).toEqual([11010, 26]);
    expect(result.movements[0].complements[0]).toMatchObject({ value: '15', description: 'dias' });
  });

  it('cai para o STJ quando o TJ não encontra', async () => {
    const fetchJson = vi
      .fn()
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValueOnce(ok([hit('SUP', [])]));
    const result = await searchDataJudByNumber(cnj, { fetchJson, sleep: async () => {} });
    expect(fetchJson.mock.calls[1][0]).toContain('api_publica_stj');
    expect(result).toMatchObject({ status: 'ok', alias: 'stj' });
  });

  it('retenta em 429 e reporta erro se persistir', async () => {
    const fetchJson = vi.fn().mockResolvedValue(fail(429));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const result = await searchDataJudByNumber(cnj, { fetchJson, sleep });
    expect(sleep).toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'error', httpStatus: 429 });
  });

  it('retorna not_found quando nenhum tribunal tem o número', async () => {
    const fetchJson = vi.fn().mockResolvedValue(ok([]));
    const result = await searchDataJudByNumber(cnj, { fetchJson, sleep: async () => {} });
    expect(result).toEqual({ status: 'not_found', triedAliases: ['tjsc', 'stj'] });
  });

  it('pula sem chave configurada', async () => {
    delete process.env.DATAJUD_API_KEY;
    resetIntelEnvCache();
    const result = await searchDataJudByNumber(cnj);
    expect(result.status).toBe('skipped');
  });
});
