import { describe, expect, it, vi } from 'vitest';
import { djenHtmlToText, parseDjenItems, searchDjenByNumber } from './djen-by-number.js';

const DIGITS = '10016378820238260704';

const item = {
  id: 738699991,
  hash: 'AOMEBVQ8YpOsaA7SmTWGNnyZd9l2za',
  data_disponibilizacao: '2026-09-28',
  siglaTribunal: 'TJSP',
  tipoComunicacao: 'Intimação',
  tipoDocumento: 'Ato ordinatório',
  nomeOrgao: 'UPJ da 1ª a 3ª Varas Cíveis',
  ativo: true,
  data_cancelamento: null,
  link: 'https://eproc1g.tjsp.jus.br/doc',
  texto:
    '<html><head><style>p{}</style></head><body><section><b>EXECU&Ccedil;&Atilde;O N&ordm; 1001637</b></section>' +
    '<section><p>Providencie o recolhimento, <span>no prazo de 15 (quinze) dias,</span>&nbsp;da planilha.</p></section></body></html>',
  destinatarios: [{ nome: 'BANCO ORIGINAL S/A', polo: 'A' }],
  destinatarioadvogados: [
    { advogado: { nome: 'MARCIO PEREZ DE REZENDE', numero_oab: '77460', uf_oab: 'SP' } },
  ],
};

function response(status: number, json: unknown = null) {
  return { ok: status >= 200 && status < 300, status, json, text: '' };
}

describe('djenHtmlToText', () => {
  it('remove tags e decodifica entidades', () => {
    expect(djenHtmlToText(item.texto)).toBe(
      'EXECUÇÃO Nº 1001637\nProvidencie o recolhimento, no prazo de 15 (quinze) dias, da planilha.',
    );
  });
});

describe('parseDjenItems', () => {
  it('lê a intimação e ignora canceladas', () => {
    const parsed = parseDjenItems([
      item,
      { ...item, hash: 'cancelada', ativo: false },
      { ...item, hash: 'antiga', data_disponibilizacao: '2025-01-10' },
    ]);
    expect(parsed.map((c) => c.id)).toEqual(['AOMEBVQ8YpOsaA7SmTWGNnyZd9l2za', 'antiga']);
    expect(parsed[0]).toMatchObject({
      availableAt: '2026-09-28',
      type: 'Intimação',
      court: 'TJSP',
      recipients: ['BANCO ORIGINAL S/A (polo ativo)', 'Adv. MARCIO PEREZ DE REZENDE (OAB SP77460)'],
    });
  });
});

describe('searchDjenByNumber', () => {
  it('pagina até acabar os itens', async () => {
    const page1 = Array.from({ length: 50 }, (_, i) => ({ ...item, hash: `h${i}` }));
    const fetchJson = vi
      .fn()
      .mockResolvedValueOnce(response(200, { count: 51, items: page1 }))
      .mockResolvedValueOnce(response(200, { count: 51, items: [{ ...item, hash: 'last' }] }));
    const result = await searchDjenByNumber(DIGITS, { fetchJson });
    expect(fetchJson).toHaveBeenCalledTimes(2);
    expect(fetchJson.mock.calls[1][0]).toContain('pagina=2');
    expect(result.status === 'ok' && result.communications).toHaveLength(51);
  });

  it('403 vira aviso de geo-bloqueio e timeout tenta de novo', async () => {
    const blocked = vi.fn().mockResolvedValue(response(403));
    expect(await searchDjenByNumber(DIGITS, { fetchJson: blocked })).toMatchObject({
      status: 'error',
      detail: expect.stringContaining('IP'),
    });

    const timeout = vi.fn().mockResolvedValue(response(0));
    const sleep = vi.fn().mockResolvedValue(undefined);
    expect(await searchDjenByNumber(DIGITS, { fetchJson: timeout, sleep })).toMatchObject({
      status: 'error',
      detail: expect.stringContaining('timeout'),
    });
    expect(timeout).toHaveBeenCalledTimes(2);
  });

  it('sem comunicações', async () => {
    const fetchJson = vi.fn().mockResolvedValue(response(200, { count: 0, items: [] }));
    expect(await searchDjenByNumber(DIGITS, { fetchJson })).toMatchObject({
      status: 'not_found',
    });
  });
});
