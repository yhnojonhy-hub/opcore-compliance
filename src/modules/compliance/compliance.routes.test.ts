import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { signJwt } from '../../middleware/auth.js';
import { createApp } from '../../index.js';
import { ComplianceStatus } from '../../contracts/enums/compliance-status.enum.js';
import { RiskLevel } from '../../contracts/enums/risk-level.enum.js';
import { emptyPfSections } from '../../contracts/types/canonical/pf.types.js';

const mockConsultDocument = vi.hoisted(() => vi.fn());
const mockBuildDossier = vi.hoisted(() => vi.fn());
const mockBuildFullComplianceDossier = vi.hoisted(() => vi.fn());

vi.mock('./compliance.service.js', () => ({
  consultDocument: mockConsultDocument,
  getCachedConsultations: vi.fn().mockResolvedValue([]),
}));

vi.mock('./dossier.service.js', () => ({
  buildDossier: mockBuildDossier,
}));

vi.mock('../intel/intel.service.js', () => ({
  createIntelDossier: vi.fn(),
  getIntelDossier: vi.fn(),
  listIntelDossiers: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  regenerateIntelDossier: vi.fn(),
  buildFullComplianceDossier: mockBuildFullComplianceDossier,
}));

vi.mock('../../db/prisma.js', () => ({
  prisma: {
    provider: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    riskRule: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
    },
  },
}));

const app = createApp();
const token = signJwt({ sub: 'test-service', service: 'opcore' });

function mockPfDossierResult() {
  const sections = emptyPfSections();
  sections.cadastral.fullName = 'Maria Silva';
  sections.cadastral.phones = [
    { ddd: 11, number: '999999999', type: 'mobile', ranking: 1, whatsapp: true, plus: null },
  ];
  sections.cadastral.emails = [{ email: 'maria@example.com', ranking: 1, hasCookie: null }];
  sections.litigation.lawsuits = [{ court: 'TJSP', type: 'Cível', status: 'Ativo', amount: 1000 }];

  return {
    dossier: {
      meta: {
        dossierId: 'd-1',
        document: '52998224725',
        documentType: 'CPF' as const,
        version: 1,
        generatedAt: '2026-09-14T12:00:00.000Z',
        completeness: 0.5,
        hash: 'abc123',
      },
      subject: { type: 'PF' as const, fullName: 'Maria Silva' },
      risk: {
        level: RiskLevel.baixo,
        score: 0,
        factors: [],
        complianceStatus: ComplianceStatus.aprovado,
        blocked: false,
        requiresManualReview: false,
        recommendation: null,
      },
      compliance: { status: ComplianceStatus.aprovado, blocked: false, alerts: [] },
      sections,
      sources: [],
      audit: { requestedBy: null, reportHash: 'abc123' },
    },
    assessment: { level: RiskLevel.baixo, score: 0 },
  };
}

describe('compliance.routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /health returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('rejects protected route without JWT', async () => {
    const res = await request(app).get('/v1/compliance/cpf/52998224725');
    expect(res.status).toBe(401);
  });

  it('returns consult result with valid JWT', async () => {
    mockConsultDocument.mockResolvedValue({
      document: '52998224725',
      documentType: 'CPF',
      provider: 'mock-provider',
      source: 'provider',
      payload: { sections: { cadastral: { fullName: 'Maria' } } },
      cachedAt: new Date().toISOString(),
      providerId: 'provider-1',
      cacheHit: false,
    });

    const res = await request(app)
      .get('/v1/compliance/cpf/52998224725')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.document).toBe('52998224725');
    expect(res.body.cacheHit).toBe(false);
    expect(res.body.rawPayload).toBeUndefined();
  });

  it('returns consult result with optional raw payload', async () => {
    mockConsultDocument.mockResolvedValue({
      document: '52998224725',
      documentType: 'CPF',
      provider: 'mock-provider',
      source: 'provider',
      payload: { sections: { cadastral: { fullName: 'Maria' } } },
      rawPayload: { data: { fullName: 'Maria' } },
      cachedAt: new Date().toISOString(),
      providerId: 'provider-1',
      cacheHit: false,
    });

    const res = await request(app)
      .get('/v1/compliance/cpf/52998224725?includeRaw=true')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.payload.sections.cadastral.fullName).toBe('Maria');
    expect(res.body.rawPayload).toEqual({ data: { fullName: 'Maria' } });
  });

  it('passes forceRefresh to consultDocument', async () => {
    mockConsultDocument.mockResolvedValue({
      document: '52998224725',
      documentType: 'CPF',
      provider: 'mock-provider',
      source: 'provider',
      payload: { sections: { cadastral: { fullName: 'João' } } },
      cachedAt: new Date().toISOString(),
      providerId: 'provider-1',
      cacheHit: false,
    });

    const res = await request(app)
      .get('/v1/compliance/cpf/52998224725?forceRefresh=true')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(mockConsultDocument).toHaveBeenCalledWith(
      expect.objectContaining({ forceRefresh: true }),
    );
  });

  it('GET /v1/compliance/slices lists catalog', async () => {
    const res = await request(app)
      .get('/v1/compliance/slices')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'contacts' }),
        expect.objectContaining({ id: 'qsa', documentTypes: 'CNPJ' }),
      ]),
    );
  });

  it('GET dossier/:document/contacts returns contacts slice', async () => {
    mockBuildDossier.mockResolvedValue(mockPfDossierResult());

    const res = await request(app)
      .get('/v1/compliance/dossier/52998224725/contacts')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.slice).toBe('contacts');
    expect(res.body.data.fullName).toBe('Maria Silva');
    expect(res.body.data.phones).toHaveLength(1);
    expect(res.body.data.emails[0].email).toBe('maria@example.com');
    expect(mockBuildDossier).toHaveBeenCalled();
  });

  it('GET dossier/:document/lawsuits returns lawsuits slice', async () => {
    mockBuildDossier.mockResolvedValue(mockPfDossierResult());

    const res = await request(app)
      .get('/v1/compliance/dossier/52998224725/lawsuits')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.slice).toBe('lawsuits');
    expect(res.body.data.lawsuits[0].type).toBe('Cível');
  });

  it('returns 404 for unknown slice', async () => {
    const res = await request(app)
      .get('/v1/compliance/dossier/52998224725/not-a-slice')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Unknown dossier slice/);
    expect(mockBuildDossier).not.toHaveBeenCalled();
  });

  it('returns 400 when PJ-only slice is requested for CPF', async () => {
    const res = await request(app)
      .get('/v1/compliance/dossier/52998224725/qsa?documentType=CPF')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/only available for documentType=CNPJ/);
    expect(mockBuildDossier).not.toHaveBeenCalled();
  });

  it('GET dossier/:document/full is not captured by slice route', async () => {
    mockBuildFullComplianceDossier.mockResolvedValue({
      intel: { id: 'intel-1', status: 'ready' },
      canonical: { meta: { document: '58426534000164' } },
    });

    const res = await request(app)
      .get('/v1/compliance/dossier/58426534000164/full?documentType=CNPJ')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.intel).toBeDefined();
    expect(mockBuildFullComplianceDossier).toHaveBeenCalled();
    expect(mockBuildDossier).not.toHaveBeenCalled();
  });
});
