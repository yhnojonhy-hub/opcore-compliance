import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Provider } from '@prisma/client';
import { executeProvider } from './provider.executor.js';

function baseProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'provider-1',
    slug: 'lemit-cpf',
    name: 'Lemit — CPF',
    baseUrl: 'https://api.lemit.com.br',
    httpMethod: 'POST',
    requestTemplate: {
      path: '/api/v1/consulta/pessoa',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: { documento: '{{document}}' },
    },
    authType: 'bearer',
    authConfigRef: 'LEMIT_API_TOKEN',
    fieldMappings: [],
    supportedTypes: ['CPF'],
    isActive: true,
    priority: 20,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Provider;
}

describe('executeProvider form-urlencoded', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LEMIT_API_TOKEN;
    delete process.env.BIGDATACORP_ACCESS_TOKEN;
  });

  it('POSTs application/x-www-form-urlencoded body with Bearer auth', async () => {
    process.env.LEMIT_API_TOKEN = 'test-token';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ data_consulta: '2026-09-02T16:19:40-03:00', pessoa: { nome: 'JOAO' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await executeProvider(baseProvider(), {
      document: '00011122233300',
      documentType: 'CPF',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.lemit.com.br/api/v1/consulta/pessoa');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    });
    expect(init.body).toBe('documento=00011122233300');
    expect(result).toEqual({
      data_consulta: '2026-09-02T16:19:40-03:00',
      pessoa: { nome: 'JOAO' },
    });
  });

  it('throws when JSON body is an auth error envelope without useful data', async () => {
    process.env.LEMIT_API_TOKEN = 'bad-token';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ error: 'nao autorizado' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      executeProvider(baseProvider(), { document: '00011122233300', documentType: 'CPF' }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('nao autorizado'),
      upstreamStatus: 401,
    });
  });

  it('keeps JSON body when Content-Type is application/json', async () => {
    process.env.BIGDATACORP_ACCESS_TOKEN = 'bdc-token';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ Result: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await executeProvider(
      baseProvider({
        slug: 'bigdatacorp-pf-basic_data',
        authType: 'bearer',
        authConfigRef: 'BIGDATACORP_ACCESS_TOKEN',
        requestTemplate: {
          path: '/pessoas',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: { q: '{{document}}', Datasets: 'basic_data' },
        },
      }),
      { document: '12345678901', documentType: 'CPF' },
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(JSON.stringify({ q: '12345678901', Datasets: 'basic_data' }));
  });
});
