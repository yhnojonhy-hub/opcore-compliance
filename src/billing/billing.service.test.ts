import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./usage-ledger.js', () => ({
  startOfMonth: () => new Date('2026-09-01T00:00:00Z'),
  countUsageBySlug: vi.fn(async (vendor: string) =>
    vendor === 'bigdatacorp' ? { 'bigdatacorp-pf-kyc': 100, 'bigdatacorp-pj-basic_data': 50 } : {},
  ),
  sumCredits: vi.fn(async () => 0),
}));

import {
  getApolloCard,
  getBigDataCorpCard,
  getLemitCard,
  parseApolloRateLimits,
} from './billing.service.js';
import { estimateBdcMonth } from './prices.js';

type Fetcher = Parameters<typeof getLemitCard>[1];

function fakeFetch(status: number, json: unknown): Fetcher {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json,
    text: JSON.stringify(json),
  })) as unknown as Fetcher;
}

const monthStart = new Date('2026-09-01T00:00:00Z');

describe('billing.service', () => {
  beforeEach(() => {
    process.env.LEMIT_API_TOKEN = 'lemit-token';
    process.env.APOLLO_API_KEY = 'apollo-key';
  });

  afterEach(() => {
    delete process.env.LEMIT_API_TOKEN;
    delete process.env.APOLLO_API_KEY;
    delete process.env.BILLING_LEMIT_LOW_BALANCE;
  });

  it('lemit: saldo ok', async () => {
    const card = await getLemitCard(monthStart, fakeFetch(200, { saldo: 3000, consumo: 1.2 }));
    expect(card.status).toBe('ok');
    expect(card.lemit).toEqual({ saldo: 3000, consumo: 1.2 });
  });

  it('lemit: saldo baixo', async () => {
    const card = await getLemitCard(monthStart, fakeFetch(200, { saldo: 10, consumo: 2990 }));
    expect(card.status).toBe('low_balance');
  });

  it('lemit: IP fora da política', async () => {
    const card = await getLemitCard(
      monthStart,
      fakeFetch(403, {
        errors: ['Acesso fora do local permitido de acordo com as políticas da sua empresa.'],
      }),
    );
    expect(card.status).toBe('ip_blocked');
  });

  it('lemit: sem token', async () => {
    delete process.env.LEMIT_API_TOKEN;
    const fetcher = fakeFetch(200, {});
    const card = await getLemitCard(monthStart, fetcher);
    expect(card.status).toBe('not_configured');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('apollo: problema de pagamento', async () => {
    const card = await getApolloCard(
      monthStart,
      fakeFetch(422, {
        message: 'API temporarily unavailable. There is an issue with your payment.',
      }),
    );
    expect(card.status).toBe('payment_issue');
  });

  it('apollo: 403 exige master key', async () => {
    const card = await getApolloCard(monthStart, fakeFetch(403, { error: 'forbidden' }));
    expect(card.status).toBe('unauthorized');
    expect(card.statusMessage).toMatch(/master/);
  });

  it('apollo: rate limits', async () => {
    const card = await getApolloCard(
      monthStart,
      fakeFetch(200, {
        '["api/v1/people", "match"]': {
          day: { limit: 600, consumed: 10, left_over: 590 },
          hour: { limit: 200, consumed: 1, left_over: 199 },
        },
      }),
    );
    expect(card.status).toBe('ok');
    expect(card.apollo?.rateLimits).toHaveLength(2);
  });

  it('parseApolloRateLimits ignora entradas sem janelas', () => {
    expect(parseApolloRateLimits({ foo: 'bar' })).toEqual([]);
  });

  it('bdc: estimativa pelo ledger', async () => {
    const card = await getBigDataCorpCard(monthStart);
    expect(card.status).toBe('no_api');
    expect(card.bigdatacorp?.requests).toBe(150);
    // 100 × 0,06 + 50 × 0,03
    expect(card.bigdatacorp?.estimatedBrl).toBe(7.5);
  });
});

describe('estimateBdcMonth', () => {
  it('aplica desconto por volume total', () => {
    const estimate = estimateBdcMonth({ 'bigdatacorp-pf-kyc': 20_000 });
    expect(estimate.discount).toBe(0.05);
    expect(estimate.grossBrl).toBe(1200);
    expect(estimate.estimatedBrl).toBe(1140);
  });

  it('conta consultas sem preço conhecido', () => {
    const estimate = estimateBdcMonth({ 'bigdatacorp-inexistente': 3 });
    expect(estimate.unpricedRequests).toBe(3);
    expect(estimate.estimatedBrl).toBe(0);
  });
});
