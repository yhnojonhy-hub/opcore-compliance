import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConsultResult } from '../compliance/compliance.service.js';
import { ProviderHttpError } from '../../providers/provider.errors.js';
import {
  buildBdcNameEmailQuery,
  pickCpfFromBdcResults,
  phonesFromConsult,
  primaryPhoneNumber,
  resolvePhone,
} from './resolve-phone.service.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '../../providers/__fixtures__');

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, name), 'utf8'));
}

function consultResult(overrides: Partial<ConsultResult> & { phones?: unknown[] }): ConsultResult {
  const phones = overrides.phones ?? [];
  return {
    document: '00011122233300',
    documentType: 'CPF',
    provider: overrides.provider ?? 'lemit-cpf',
    source: 'provider',
    payload: {
      sections: {
        cadastral: {
          phones,
        },
      },
    },
    cachedAt: new Date().toISOString(),
    providerId: 'p1',
    cacheHit: false,
    ...overrides,
  };
}

describe('buildBdcNameEmailQuery', () => {
  it('builds name+email q clause', () => {
    expect(buildBdcNameEmailQuery('João Silva', 'joao@ex.com')).toBe(
      'name{João Silva}, email{joao@ex.com}',
    );
  });

  it('strips braces from values', () => {
    expect(buildBdcNameEmailQuery('A{B},C', 'a@b.com')).toBe('name{A B C}, email{a@b.com}');
  });
});

describe('pickCpfFromBdcResults', () => {
  it('picks CPF when email matches fixture', () => {
    const fixture = loadFixture('bdc-name-email-response.json');
    expect(pickCpfFromBdcResults(fixture, 'joao.silva@example.com')).toBe('52998224725');
  });

  it('returns null when multiple CPFs and no email match', () => {
    const payload = {
      Result: [
        { BasicData: { TaxIdNumber: '11111111111' } },
        { BasicData: { TaxIdNumber: '22222222222' } },
      ],
    };
    expect(pickCpfFromBdcResults(payload, 'x@y.com')).toBeNull();
  });

  it('accepts single CPF when query already constrained by email', () => {
    const payload = {
      Result: [{ BasicData: { TaxIdNumber: '12345678901' } }],
    };
    expect(pickCpfFromBdcResults(payload, 'any@ex.com')).toBe('12345678901');
  });
});

describe('phonesFromConsult / primaryPhoneNumber', () => {
  it('formats primary phone with country code', () => {
    const phones = phonesFromConsult(
      consultResult({
        phones: [{ ddd: 11, numero: '999990000', ranking: 1 }],
      }),
    );
    // normalizePhoneList reads `number`/`numero`
    expect(primaryPhoneNumber(phones)).toBe('+5511999990000');
  });
});

describe('resolvePhone', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty without email (no name-only lookup)', async () => {
    const result = await resolvePhone({ name: 'João Silva' });
    expect(result).toEqual({ document: null, phones: [], source: null });
  });

  it('returns lemit phones when Lemit has celulares', async () => {
    const consult = vi.fn(async (params: { providerSlug?: string }) => {
      if (params.providerSlug === 'lemit-cpf') {
        return consultResult({
          provider: 'lemit-cpf',
          phones: [{ ddd: 11, number: '999990000', ranking: 1, type: 'mobile' }],
        });
      }
      throw new Error(`unexpected ${params.providerSlug}`);
    });

    const result = await resolvePhone(
      { name: 'João Silva', email: 'joao.silva@example.com' },
      {
        lookupCpf: async () => '00011122233300',
        consult: consult as never,
      },
    );

    expect(result.source).toBe('lemit');
    expect(result.document).toBe('00011122233300');
    expect(result.phones[0]?.number).toBe('999990000');
    expect(consult).toHaveBeenCalledTimes(1);
  });

  it('falls back to BDC phones_extended when Lemit is empty/404', async () => {
    const consult = vi.fn(async (params: { providerSlug?: string }) => {
      if (params.providerSlug === 'lemit-cpf') {
        throw new ProviderHttpError('Not found', 'lemit-cpf', 404);
      }
      if (params.providerSlug === 'bigdatacorp-pf-phones_extended') {
        return consultResult({
          provider: 'bigdatacorp-pf-phones_extended',
          phones: [{ AreaCode: 11, Number: '988887777', Ranking: 1, Type: 'mobile' }],
        });
      }
      throw new Error(`unexpected ${params.providerSlug}`);
    });

    const result = await resolvePhone(
      { name: 'João Silva', email: 'joao.silva@example.com' },
      {
        lookupCpf: async () => '00011122233300',
        consult: consult as never,
      },
    );

    expect(result.source).toBe('bdc');
    expect(result.phones[0]?.number).toBe('988887777');
    expect(consult).toHaveBeenCalledTimes(2);
  });

  it('returns document with empty phones when both bureaus miss', async () => {
    const consult = vi.fn(async () => consultResult({ phones: [] }));
    const result = await resolvePhone(
      { name: 'João Silva', email: 'joao.silva@example.com' },
      {
        lookupCpf: async () => '00011122233300',
        consult: consult as never,
      },
    );
    expect(result).toEqual({ document: '00011122233300', phones: [], source: null });
  });

  it('returns empty when BDC identity finds no CPF', async () => {
    const result = await resolvePhone(
      { name: 'Nobody', email: 'nobody@ex.com' },
      {
        lookupCpf: async () => null,
        consult: vi.fn() as never,
      },
    );
    expect(result).toEqual({ document: null, phones: [], source: null });
  });
});
