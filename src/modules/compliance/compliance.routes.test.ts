import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { signJwt } from '../../middleware/auth.js';
import { createApp } from '../../index.js';

const mockConsultDocument = vi.hoisted(() => vi.fn());

vi.mock('./compliance.service.js', () => ({
  consultDocument: mockConsultDocument,
  getCachedConsultations: vi.fn().mockResolvedValue([]),
}));

vi.mock('./dossier.service.js', () => ({
  buildDossier: vi.fn(),
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
      payload: {},
      rawPayload: {},
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
  });
});
