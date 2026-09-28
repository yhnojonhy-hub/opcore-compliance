import type { Express } from 'express';
import { z } from 'zod';
import type { AuthedRequest } from '../../middleware/auth.js';
import { requireJwt } from '../../middleware/auth.js';
import { logAudit } from '../compliance/compliance.service.js';
import { InvalidCnjError, lookupLawsuit } from './lawsuits.service.js';

const lookupBodySchema = z.object({
  number: z.string().min(1),
  documents: z
    .array(
      z.object({
        document: z.string().min(1),
        documentType: z.enum(['CPF', 'CNPJ']),
      }),
    )
    .max(20)
    .optional(),
  forceRefresh: z.boolean().optional(),
});

export function registerLawsuitRoutes(app: Express) {
  app.post('/v1/compliance/lawsuits/lookup', requireJwt, async (req, res) => {
    const parsed = lookupBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const requestedBy = (req as AuthedRequest).auth?.sub;
    try {
      const detail = await lookupLawsuit({ ...parsed.data, requestedBy });
      void logAudit({
        action: detail.cached ? 'lawsuit_lookup_cache_hit' : 'lawsuit_lookup',
        document: detail.number,
        metadata: {
          requestedBy,
          found: detail.found,
          documents: parsed.data.documents?.length ?? 0,
          sources: detail.sources.map((s) => ({ name: s.name, status: s.status })),
        },
      }).catch(() => undefined);
      res.json(detail);
    } catch (error) {
      if (error instanceof InvalidCnjError) {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(502).json({ error: (error as Error).message });
    }
  });
}
