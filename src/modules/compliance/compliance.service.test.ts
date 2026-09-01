import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  complianceConsultation: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
}));

const mockResolveProvider = vi.hoisted(() => vi.fn());
const mockExecuteProvider = vi.hoisted(() => vi.fn());

vi.mock('../../db/prisma.js', () => ({ prisma: mockPrisma }));
vi.mock('../../providers/provider.registry.js', () => ({ resolveProvider: mockResolveProvider }));
vi.mock('../../providers/provider.executor.js', () => ({
  executeProvider: mockExecuteProvider,
  cacheExpiresAt: () => new Date('2030-01-01'),
}));

import { consultDocument } from './compliance.service.js';

const mockProvider = {
  id: 'provider-1',
  slug: 'mock-provider',
  name: 'Mock',
  baseUrl: 'mock://local',
  httpMethod: 'GET',
  requestTemplate: {},
  authType: 'mock',
  authConfigRef: null,
  fieldMappings: [{ source: '$.data.fullName', target: 'sections.cadastral.fullName' }],
  supportedTypes: ['CPF'],
  isActive: true,
  priority: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('compliance.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveProvider.mockResolvedValue(mockProvider);
    mockPrisma.auditLog.create.mockResolvedValue({});
  });

  it('returns cache hit when consultation is valid', async () => {
    const cachedAt = new Date('2026-01-01T00:00:00Z');
    mockPrisma.complianceConsultation.findUnique.mockResolvedValue({
      document: '52998224725',
      documentType: 'CPF',
      providerId: 'provider-1',
      payload: { 'sections.cadastral.fullName': 'Maria' },
      rawPayload: { data: { fullName: 'Maria' } },
      updatedAt: cachedAt,
      expiresAt: new Date('2030-01-01'),
    });

    const result = await consultDocument({
      document: '52998224725',
      documentType: 'CPF',
    });

    expect(result.cacheHit).toBe(true);
    expect(result.source).toBe('cache');
    expect(mockExecuteProvider).not.toHaveBeenCalled();
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'cache_hit' }) }),
    );
  });

  it('calls provider and persists on cache miss', async () => {
    mockPrisma.complianceConsultation.findUnique.mockResolvedValue(null);
    mockExecuteProvider.mockResolvedValue({ data: { fullName: 'João' } });
    mockPrisma.complianceConsultation.upsert.mockResolvedValue({});

    const result = await consultDocument({
      document: '52998224725',
      documentType: 'CPF',
    });

    expect(result.cacheHit).toBe(false);
    expect(result.source).toBe('provider');
    expect(mockExecuteProvider).toHaveBeenCalledOnce();
    expect(mockPrisma.complianceConsultation.upsert).toHaveBeenCalled();
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'cache_miss' }) }),
    );
  });
});
