import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { signJwt } from '../../middleware/auth.js';

const mockSearch = vi.hoisted(() => vi.fn());
const mockAudit = vi.hoisted(() => vi.fn());

vi.mock('./lawsuits.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lawsuits.service.js')>()),
  searchLawsuit: mockSearch,
}));

vi.mock('../compliance/compliance.service.js', () => ({
  consultDocument: vi.fn(),
  getCachedConsultations: vi.fn().mockResolvedValue([]),
  logAudit: mockAudit,
}));

vi.mock('../../db/prisma.js', () => ({ prisma: {} }));

const { createApp } = await import('../../index.js');
const { InvalidLawsuitNumberError } = await import('./lawsuits.service.js');

const app = createApp();
const token = signJwt({ sub: 'juridico', service: 'juridico' });
const url = '/v1/compliance/lawsuits/search';
const CNPJ = '34258765000148';

describe('POST /v1/compliance/lawsuits/search', () => {
  beforeEach(() => {
    mockSearch.mockReset();
    mockAudit.mockReset();
  });

  it('exige JWT', async () => {
    const res = await request(app).post(url).send({});
    expect(res.status).toBe(401);
  });

  it('valida o corpo e os documentos', async () => {
    const auth = { Authorization: `Bearer ${token}` };
    expect((await request(app).post(url).set(auth).send({ number: '1' })).status).toBe(400);
    const badDoc = await request(app)
      .post(url)
      .set(auth)
      .send({ number: '1', documents: [{ document: '11111111111111', documentType: 'CNPJ' }] });
    expect(badDoc.status).toBe(400);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('devolve o resultado e registra auditoria', async () => {
    mockSearch.mockResolvedValue({
      number: '1'.repeat(20),
      found: true,
      movements: [],
      sources: [],
    });
    const res = await request(app)
      .post(url)
      .set('Authorization', `Bearer ${token}`)
      .send({
        number: '1'.repeat(20),
        documents: [{ document: CNPJ, documentType: 'CNPJ' }],
        forceRefresh: true,
      });
    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(mockSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        documents: [{ document: CNPJ, documentType: 'CNPJ' }],
        forceRefresh: true,
      }),
    );
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'lawsuit_search' }));
  });

  it('número inválido responde 400', async () => {
    mockSearch.mockRejectedValue(new InvalidLawsuitNumberError('Número de processo inválido'));
    const res = await request(app)
      .post(url)
      .set('Authorization', `Bearer ${token}`)
      .send({ number: '123', documents: [{ document: CNPJ, documentType: 'CNPJ' }] });
    expect(res.status).toBe(400);
  });
});
