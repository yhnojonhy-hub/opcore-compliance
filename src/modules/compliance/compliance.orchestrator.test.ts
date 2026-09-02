import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Provider } from '@prisma/client';
import { ProviderHttpError } from '../../providers/provider.errors.js';

const mockConsultDocument = vi.fn();
const mockLogAudit = vi.fn();
const mockFindMany = vi.fn();

vi.mock('../../db/prisma.js', () => ({
  prisma: {
    provider: { findMany: (...args: unknown[]) => mockFindMany(...args) },
  },
}));

vi.mock('./compliance.service.js', () => ({
  consultDocument: (...args: unknown[]) => mockConsultDocument(...args),
  logAudit: (...args: unknown[]) => mockLogAudit(...args),
}));

vi.mock('../../lib/env.js', () => ({
  env: { bdcConsultConcurrency: 2, bdcMaxTier: 1 },
}));

import { consultAllForDocument } from './compliance.orchestrator.js';

function provider(slug: string): Provider {
  return {
    id: slug,
    slug,
    name: slug,
    baseUrl: 'https://example.com',
    httpMethod: 'POST',
    requestTemplate: { _bdcMeta: { activationTier: 1 } },
    authType: 'mock',
    authConfigRef: null,
    fieldMappings: [],
    supportedTypes: ['CNPJ'],
    isActive: true,
    priority: 20,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('compliance.orchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindMany.mockResolvedValue([provider('a'), provider('b')]);
    mockLogAudit.mockResolvedValue(undefined);
  });

  it('returns partial results when some providers fail', async () => {
    mockConsultDocument
      .mockResolvedValueOnce({
        document: '58426534000164',
        documentType: 'CNPJ',
        provider: 'a',
        source: 'provider',
        payload: {},
        rawPayload: {},
        cachedAt: new Date().toISOString(),
        providerId: 'a',
        cacheHit: false,
      })
      .mockRejectedValueOnce(new ProviderHttpError('dataset disabled', 'b', 502));

    const results = await consultAllForDocument({
      document: '58426534000164',
      documentType: 'CNPJ',
    });

    expect(results).toHaveLength(1);
    expect(results[0].provider).toBe('a');
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'provider_consult_failed' }),
    );
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'orchestrator_partial_failure' }),
    );
  });

  it('throws when all providers fail', async () => {
    mockConsultDocument.mockRejectedValue(new ProviderHttpError('fail', 'a', 502));

    await expect(
      consultAllForDocument({ document: '58426534000164', documentType: 'CNPJ' }),
    ).rejects.toBeInstanceOf(ProviderHttpError);
  });

  it('failFast rethrows on first provider error', async () => {
    mockConsultDocument.mockRejectedValue(new ProviderHttpError('fail', 'a', 502));

    await expect(
      consultAllForDocument({
        document: '58426534000164',
        documentType: 'CNPJ',
        failFast: true,
      }),
    ).rejects.toBeInstanceOf(ProviderHttpError);
  });

  it('consults BigDataCorp before complementary providers', async () => {
    const order: string[] = [];
    mockFindMany.mockResolvedValue([
      provider('lemit-cnpj'),
      {
        ...provider('bigdatacorp-pj-basic_data'),
        slug: 'bigdatacorp-pj-basic_data',
        id: 'bigdatacorp-pj-basic_data',
      },
    ]);
    mockConsultDocument.mockImplementation(async (args: { providerSlug: string }) => {
      order.push(args.providerSlug);
      return {
        document: '58426534000164',
        documentType: 'CNPJ',
        provider: args.providerSlug,
        source: 'provider',
        payload: {},
        rawPayload: {},
        cachedAt: new Date().toISOString(),
        providerId: args.providerSlug,
        cacheHit: false,
      };
    });

    await consultAllForDocument({
      document: '58426534000164',
      documentType: 'CNPJ',
    });

    expect(order[0]).toBe('bigdatacorp-pj-basic_data');
    expect(order[1]).toBe('lemit-cnpj');
  });

  it('softFail returns empty list when all providers fail', async () => {
    mockConsultDocument.mockRejectedValue(new ProviderHttpError('fail', 'a', 502));

    await expect(
      consultAllForDocument({
        document: '58426534000164',
        documentType: 'CNPJ',
        softFail: true,
      }),
    ).resolves.toEqual([]);
  });

  it('filters by slugPrefixes when provided', async () => {
    mockFindMany.mockResolvedValue([
      provider('lemit-cnpj'),
      {
        ...provider('bigdatacorp-pj-basic_data'),
        slug: 'bigdatacorp-pj-basic_data',
        id: 'bigdatacorp-pj-basic_data',
      },
    ]);
    mockConsultDocument.mockImplementation(async (args: { providerSlug: string }) => ({
      document: '58426534000164',
      documentType: 'CNPJ',
      provider: args.providerSlug,
      source: 'provider',
      payload: {},
      rawPayload: {},
      cachedAt: new Date().toISOString(),
      providerId: args.providerSlug,
      cacheHit: false,
    }));

    const results = await consultAllForDocument({
      document: '58426534000164',
      documentType: 'CNPJ',
      slugPrefixes: ['bigdatacorp'],
      skipBdcPartition: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0].provider).toBe('bigdatacorp-pj-basic_data');
    expect(mockConsultDocument).toHaveBeenCalledTimes(1);
  });
});
