import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ProviderHttpError } from '../../providers/provider.errors.js';

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
        expect(args.softFail).toBe(false);
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

  it('uses lemit-cnpj slug for CNPJ targets', async () => {
    const slugs: string[] = [];
    mockConsultAll.mockImplementation(async (args: Record<string, unknown>) => {
      if (args.slugPrefixes) {
        return [{ provider: 'bigdatacorp-pj-basic_data', payload: { sections: {} } }];
      }
      if (typeof args.providerSlug === 'string') {
        slugs.push(args.providerSlug);
        return [{ provider: args.providerSlug, payload: { sections: {} } }];
      }
      return [];
    });

    await runFourPillarPipeline({
      dossierId: 'd1',
      target: '58426534000164',
      targetType: 'CNPJ',
    });

    expect(slugs).toContain('lemit-cnpj');
    expect(slugs).toContain('brasilapi-cnpj');
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

  it('treats Lemit HTTP 404 as ok with CHECKED_ABSENT finding', async () => {
    mockConsultAll.mockImplementation(async (args: Record<string, unknown>) => {
      if (args.slugPrefixes) {
        return [{ provider: 'bigdatacorp-pf-basic_data', payload: { sections: {} } }];
      }
      if (args.providerSlug === 'lemit-cpf') {
        throw new ProviderHttpError(
          'Provedor lemit-cpf retornou HTTP 404: Not found.',
          'lemit-cpf',
          404,
        );
      }
      return [{ provider: 'brasilapi-cpf', payload: { sections: {} } }];
    });

    const result = await runFourPillarPipeline({
      dossierId: 'd1',
      target: '10723555079',
      targetType: 'CPF',
    });

    expect(result.pillars.lemit.status).toBe('ok');
    expect(result.pillars.lemit.providerCount).toBe(1);
    expect(result.pillars.lemit.findingCount).toBe(1);
    expect(result.pillars.lemit.error).toBeUndefined();
    expect(mockSourceCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Lemit',
          providerSlug: 'lemit-cpf',
          status: 'ok',
          reliability: 'PAID',
        }),
      }),
    );
    expect(mockFindingCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            sourceName: 'Lemit',
            title: 'Consultado — nada consta na base Lemit',
            details: expect.objectContaining({ consultedAbsent: true, status: 'CHECKED_ABSENT' }),
          }),
        ]),
      }),
    );
    expect(result.pillars.brasilapi.status).toBe('ok');
  });

  it('marks Lemit pillar as error on HTTP 401', async () => {
    mockConsultAll.mockImplementation(async (args: Record<string, unknown>) => {
      if (args.slugPrefixes) {
        return [{ provider: 'bigdatacorp-pf-basic_data', payload: { sections: {} } }];
      }
      if (args.providerSlug === 'lemit-cpf') {
        throw new ProviderHttpError('Provedor lemit-cpf: nao autorizado', 'lemit-cpf', 401);
      }
      return [{ provider: 'brasilapi-cpf', payload: { sections: {} } }];
    });

    const result = await runFourPillarPipeline({
      dossierId: 'd1',
      target: '37740937843',
      targetType: 'CPF',
    });

    expect(result.pillars.lemit.status).toBe('error');
    expect(result.pillars.lemit.providerCount).toBe(0);
    expect(result.pillars.lemit.error).toContain('nao autorizado');
    expect(result.pillars.brasilapi.status).toBe('ok');
  });
});
