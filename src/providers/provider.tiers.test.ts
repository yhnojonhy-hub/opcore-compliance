import { describe, expect, it } from 'vitest';
import type { Provider } from '@prisma/client';
import {
  filterProvidersByTier,
  getProviderActivationTier,
  isOsintAdapterProvider,
  partitionBureauProviders,
  providerMatchesTier,
} from './provider.tiers.js';

function providerWithTier(tier: number): Provider {
  return {
    id: 'p1',
    slug: 'bigdatacorp-pj-kyc',
    name: 'KYC',
    baseUrl: 'https://example.com',
    httpMethod: 'POST',
    requestTemplate: { _bdcMeta: { activationTier: tier } },
    authType: 'env_headers',
    authConfigRef: null,
    fieldMappings: [],
    supportedTypes: ['CNPJ'],
    isActive: true,
    priority: 20,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function lemitProvider(): Provider {
  return {
    ...providerWithTier(1),
    id: 'lemit',
    slug: 'lemit-cpf',
    name: 'Lemit',
    requestTemplate: { path: '/api/v1/consulta/{{document}}' },
    priority: 20,
    supportedTypes: ['CPF'],
  };
}

function osintProvider(): Provider {
  return {
    ...providerWithTier(1),
    id: 'osint',
    slug: 'osint-datajud-cnj',
    name: 'DataJud CNJ',
    requestTemplate: {
      _providerMeta: { adapterRef: 'osint-datajud-cnj', outputMode: 'findings' },
    },
    priority: 50,
    supportedTypes: ['CPF'],
  };
}

describe('provider.tiers', () => {
  it('reads activation tier from requestTemplate._bdcMeta', () => {
    expect(getProviderActivationTier(providerWithTier(1))).toBe(1);
    expect(getProviderActivationTier(providerWithTier(3))).toBe(3);
  });

  it('returns null when _bdcMeta is missing (non-BDC)', () => {
    expect(getProviderActivationTier(lemitProvider())).toBeNull();
  });

  it('always matches non-BDC providers regardless of max tier', () => {
    expect(providerMatchesTier(lemitProvider(), 1)).toBe(true);
  });

  it('filters BDC providers by max tier', () => {
    expect(providerMatchesTier(providerWithTier(1), 1)).toBe(true);
    expect(providerMatchesTier(providerWithTier(2), 1)).toBe(false);
    expect(providerMatchesTier(providerWithTier(2), 2)).toBe(true);
  });

  it('excludes OSINT adapter seeds from bureau consult list', async () => {
    const filtered = await filterProvidersByTier(
      [providerWithTier(1), lemitProvider(), osintProvider()],
      1,
    );
    expect(filtered.map((p) => p.slug)).toEqual(['bigdatacorp-pj-kyc', 'lemit-cpf']);
    expect(isOsintAdapterProvider(osintProvider())).toBe(true);
  });

  it('partitions BigDataCorp as primary and others as complementary', () => {
    const { primary, complementary } = partitionBureauProviders([
      providerWithTier(1),
      lemitProvider(),
    ]);
    expect(primary.map((p) => p.slug)).toEqual(['bigdatacorp-pj-kyc']);
    expect(complementary.map((p) => p.slug)).toEqual(['lemit-cpf']);
  });
});
