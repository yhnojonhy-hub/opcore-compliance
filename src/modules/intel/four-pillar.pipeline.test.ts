import { describe, expect, it, vi, beforeEach } from 'vitest';

const {
  mockConsultAll,
  mockRunIntelSearch,
  mockUpdate,
  mockSourceCreate,
  mockFindingCreateMany,
  mockSourceCount,
  mockFindingCount,
  mockAuditCreate,
} = vi.hoisted(() => ({
  mockConsultAll: vi.fn(),
  mockRunIntelSearch: vi.fn(),
  mockUpdate: vi.fn(),
  mockSourceCreate: vi.fn(),
  mockFindingCreateMany: vi.fn(),
  mockSourceCount: vi.fn(),
  mockFindingCount: vi.fn(),
  mockAuditCreate: vi.fn(),
}));

vi.mock('../compliance/compliance.orchestrator.js', () => ({
  consultAllForDocument: (...args: unknown[]) => mockConsultAll(...args),
}));

vi.mock('./intel.orchestrator.js', () => ({
  runIntelSearch: (...args: unknown[]) => mockRunIntelSearch(...args),
}));

vi.mock('../../db/prisma.js', () => ({
  prisma: {
    intelDossier: { update: (...args: unknown[]) => mockUpdate(...args) },
    intelDossierSource: {
      create: (...args: unknown[]) => mockSourceCreate(...args),
      count: (...args: unknown[]) => mockSourceCount(...args),
    },
    intelDossierFinding: {
      createMany: (...args: unknown[]) => mockFindingCreateMany(...args),
      count: (...args: unknown[]) => mockFindingCount(...args),
    },
    intelDossierAuditLog: {
      create: (...args: unknown[]) => mockAuditCreate(...args),
    },
  },
}));

import { runFourPillarPipeline } from './four-pillar.pipeline.js';

describe('runFourPillarPipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockResolvedValue({});
    mockSourceCreate.mockResolvedValue({});
    mockFindingCreateMany.mockResolvedValue({ count: 0 });
    mockSourceCount.mockResolvedValue(0);
    mockFindingCount.mockResolvedValue(0);
    mockAuditCreate.mockResolvedValue({});
    mockRunIntelSearch.mockResolvedValue(undefined);
  });

  it('runs BDC then Lemit then BrasilAPI then Extras in order', async () => {
    const order: string[] = [];
    mockConsultAll.mockImplementation(async (args: Record<string, unknown>) => {
      if (args.slugPrefixes) {
        order.push('bdc');
        return [
          {
            provider: 'bigdatacorp-pf-basic_data',
            payload: { sections: { cadastral: { fullName: 'JOAO' } } },
          },
        ];
      }
      if (args.providerSlug === 'lemit-cpf') {
        order.push('lemit');
        return [{ provider: 'lemit-cpf', payload: { sections: {} } }];
      }
      if (args.providerSlug === 'brasilapi-cpf') {
        order.push('brasilapi');
        return [{ provider: 'brasilapi-cpf', payload: { sections: {} } }];
      }
      return [];
    });
    mockRunIntelSearch.mockImplementation(async () => {
      order.push('extras');
    });

    const result = await runFourPillarPipeline({
      dossierId: 'd1',
      target: '37740937843',
      targetType: 'CPF',
      forceRefresh: true,
    });

    expect(order).toEqual(['bdc', 'lemit', 'brasilapi', 'extras']);
    expect(result.pillars.bdc.status).toBe('ok');
    expect(result.partyName).toBe('JOAO');
    expect(mockConsultAll.mock.calls[0][0].slugPrefixes).toEqual(['bigdatacorp']);
  });

  it('continues remaining pillars when BDC soft-fails empty', async () => {
    mockConsultAll.mockImplementation(async (args: Record<string, unknown>) => {
      if (args.slugPrefixes) return [];
      if (args.providerSlug === 'lemit-cpf') {
        return [{ provider: 'lemit-cpf', payload: { sections: { cadastral: { fullName: 'X' } } } }];
      }
      return [{ provider: 'brasilapi-cpf', payload: { sections: {} } }];
    });

    const result = await runFourPillarPipeline({
      dossierId: 'd1',
      target: '37740937843',
      targetType: 'CPF',
    });

    expect(result.pillars.bdc.status).toBe('error');
    expect(result.pillars.lemit.status).toBe('ok');
    expect(result.pillars.brasilapi.status).toBe('ok');
    expect(result.pillars.extras.status).toBe('ok');
  });
});
