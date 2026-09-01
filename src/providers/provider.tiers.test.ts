import { describe, expect, it } from 'vitest';
import type { Provider } from '@prisma/client';
import { getProviderActivationTier, providerMatchesTier } from './provider.tiers.js';

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

describe('provider.tiers', () => {
  it('reads activation tier from requestTemplate._bdcMeta', () => {
    expect(getProviderActivationTier(providerWithTier(1))).toBe(1);
    expect(getProviderActivationTier(providerWithTier(3))).toBe(3);
  });

  it('defaults to tier 3 when metadata is missing', () => {
    const provider = { ...providerWithTier(1), requestTemplate: {} };
    expect(getProviderActivationTier(provider)).toBe(3);
  });

  it('filters providers by max tier', () => {
    expect(providerMatchesTier(providerWithTier(1), 1)).toBe(true);
    expect(providerMatchesTier(providerWithTier(2), 1)).toBe(false);
    expect(providerMatchesTier(providerWithTier(2), 2)).toBe(true);
  });
});
