import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { signJwt } from '../../middleware/auth.js';

const mockLookup = vi.hoisted(() => vi.fn());
const mockAudit = vi.hoisted(() => vi.fn());

vi.mock('./lawsuits.service.js', async () => {
  const actual =
    await vi.importActual<typeof import('./lawsuits.service.js')>('./lawsuits.service.js');
  return { ...actual, lookupLawsuit: mockLookup };
});
vi.mock('../compliance/compliance.service.js', () => ({
  logAudit: mockAudit,
  consultDocument: vi.fn(),
  getCachedConsultations: vi.fn(),
}));
vi.mock('../../db/prisma.js', () => ({ prisma: {} }));

const { createApp } = await import('../../index.js');
const { InvalidCnjError } = await import('./lawsuits.service.js');

const app = createApp();
const token = signJwt({ sub: 'juridico', service: 'juridico' });

describe('POST /v1/compliance/lawsuits/lookup', () => {
  beforeEach(() => {
    mockLookup.mockReset();
    mockAudit.mockReset().mockResolvedValue(undefined);
  });

  it('exige JWT', async () => {
    const res = await request(app).post('/v1/compliance/lawsuits/lookup').send({ number: 'x' });
    expect(res.status).toBe(401);
  });

  it('valida o corpo', async () => {
    const res = await request(app)
      .post('/v1/compliance/lawsuits/lookup')
      .set('Authorization', `Bearer ${token}`)
      .send({ documents: [] });
    expect(res.status).toBe(400);
  });

  it('retorna 400 para número CNJ inválido', async () => {
    mockLookup.mockRejectedValue(new InvalidCnjError('123'));
    const res = await request(app)
      .post('/v1/compliance/lawsuits/lookup')
      .set('Authorization', `Bearer ${token}`)
      .send({ number: '123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('inválido');
  });

  it('devolve o registro consolidado e audita', async () => {
    mockLookup.mockResolvedValue({
      number: '50034950220268240037',
      found: true,
      cached: false,
      sources: [{ name: 'DataJud CNJ', status: 'ok' }],
      movements: [],
    });
    const res = await request(app)
      .post('/v1/compliance/lawsuits/lookup')
      .set('Authorization', `Bearer ${token}`)
      .send({
        number: '5003495-02.2026.8.24.0037',
        documents: [{ document: '52998224725', documentType: 'CPF' }],
        forceRefresh: true,
      });
    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(mockLookup).toHaveBeenCalledWith(
      expect.objectContaining({
        number: '5003495-02.2026.8.24.0037',
        forceRefresh: true,
        requestedBy: 'juridico',
      }),
    );
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'lawsuit_lookup', document: '50034950220268240037' }),
    );
  });
});
