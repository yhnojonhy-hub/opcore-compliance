import type { Express } from 'express';
import { z } from 'zod';
import type { ComplianceConsultation, DocumentType, Prisma, Provider } from '@prisma/client';
import { validateDocument } from '../../contracts/utils/document.util.js';
import type { AuthedRequest } from '../../middleware/auth.js';
import { requireJwt } from '../../middleware/auth.js';
import { prisma } from '../../db/prisma.js';
import { consultDocument, getCachedConsultations } from './compliance.service.js';
import { buildDossier } from './dossier.service.js';
import { ProviderHttpError } from '../../providers/provider.errors.js';

function complianceErrorStatus(e: unknown): number {
  if (e instanceof ProviderHttpError) return 502;
  return 422;
}

const consultBodySchema = z.object({
  document: z.string().min(1),
  documentType: z.enum(['CPF', 'CNPJ']),
  providerSlug: z.string().optional(),
});

export function registerComplianceRoutes(app: Express) {
  app.get('/v1/compliance/cpf/:document', requireJwt, async (req, res) => {
    try {
      const document = validateDocument(req.params.document, 'CPF');
      const result = await consultDocument({
        document,
        documentType: 'CPF',
        providerSlug: req.query.providerSlug as string | undefined,
        requestedBy: (req as AuthedRequest).auth?.sub,
      });
      res.json(result);
    } catch (e) {
      res.status(complianceErrorStatus(e)).json({ error: (e as Error).message });
    }
  });

  app.get('/v1/compliance/cnpj/:document', requireJwt, async (req, res) => {
    try {
      const document = validateDocument(req.params.document, 'CNPJ');
      const result = await consultDocument({
        document,
        documentType: 'CNPJ',
        providerSlug: req.query.providerSlug as string | undefined,
        requestedBy: (req as AuthedRequest).auth?.sub,
      });
      res.json(result);
    } catch (e) {
      res.status(complianceErrorStatus(e)).json({ error: (e as Error).message });
    }
  });

  app.post('/v1/compliance/consult', requireJwt, async (req, res) => {
    const parsed = consultBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const document = validateDocument(parsed.data.document, parsed.data.documentType);
      const result = await consultDocument({
        document,
        documentType: parsed.data.documentType,
        providerSlug: parsed.data.providerSlug,
        requestedBy: (req as AuthedRequest).auth?.sub,
      });
      res.json(result);
    } catch (e) {
      res.status(complianceErrorStatus(e)).json({ error: (e as Error).message });
    }
  });

  app.get('/v1/compliance/cache/:document', requireJwt, async (req, res) => {
    const documentType = req.query.documentType as DocumentType | undefined;
    const rows = await getCachedConsultations(req.params.document, documentType);
    res.json({
      document: req.params.document,
      items: rows.map((r: ComplianceConsultation & { provider: Provider }) => ({
        documentType: r.documentType,
        provider: r.provider.slug,
        cachedAt: r.updatedAt,
        expiresAt: r.expiresAt,
      })),
    });
  });

  app.get('/v1/compliance/dossier/:document', requireJwt, async (req, res) => {
    const documentType = (req.query.documentType as DocumentType) ?? 'CPF';
    try {
      const document = validateDocument(req.params.document, documentType);
      const { dossier } = await buildDossier({
        document,
        documentType,
        providerSlug: req.query.providerSlug as string | undefined,
        requestedBy: (req as AuthedRequest).auth?.sub,
      });
      res.json(dossier);
    } catch (e) {
      res.status(complianceErrorStatus(e)).json({ error: (e as Error).message });
    }
  });

  app.get('/v1/compliance/dossier/:document/risk', requireJwt, async (req, res) => {
    const documentType = (req.query.documentType as DocumentType) ?? 'CPF';
    try {
      const document = validateDocument(req.params.document, documentType);
      const { assessment } = await buildDossier({
        document,
        documentType,
        providerSlug: req.query.providerSlug as string | undefined,
        requestedBy: (req as AuthedRequest).auth?.sub,
      });
      res.json(assessment);
    } catch (e) {
      res.status(complianceErrorStatus(e)).json({ error: (e as Error).message });
    }
  });
}

export function registerRiskRuleRoutes(app: Express) {
  const ruleSchema = z.object({
    code: z.string().min(1),
    name: z.string().min(1),
    documentTypes: z.array(z.enum(['CPF', 'CNPJ'])),
    condition: z.record(z.unknown()),
    weight: z.number().int(),
    severity: z.string(),
    hardStop: z.boolean().default(false),
    minRiskLevel: z.enum(['baixo', 'medio', 'alto', 'muito_alto']).nullable().optional(),
    isActive: z.boolean().default(true),
  });

  app.get('/v1/risk-rules', requireJwt, async (_req, res) => {
    const rules = await prisma.riskRule.findMany({ where: { isActive: true } });
    res.json({ items: rules });
  });

  app.post('/v1/risk-rules', requireJwt, async (req, res) => {
    const parsed = ruleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const rule = await prisma.riskRule.create({
      data: {
        ...parsed.data,
        condition: parsed.data.condition as Prisma.InputJsonValue,
        minRiskLevel: parsed.data.minRiskLevel ?? undefined,
      },
    });
    res.status(201).json(rule);
  });
}
