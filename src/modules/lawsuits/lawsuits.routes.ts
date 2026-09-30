import type { Express } from 'express';
import { z } from 'zod';
import { validateDocument } from '../../contracts/utils/document.util.js';
import type { AuthedRequest } from '../../middleware/auth.js';
import { requireJwt } from '../../middleware/auth.js';
import { logAudit } from '../compliance/compliance.service.js';
import { InvalidLawsuitNumberError, searchLawsuit } from './lawsuits.service.js';

const searchBodySchema = z.object({
  number: z.string().min(1),
  documents: z
    .array(z.object({ document: z.string().min(1), documentType: z.enum(['CPF', 'CNPJ']) }))
    .min(1)
    .max(20),
  forceRefresh: z.boolean().optional(),
});

export function registerLawsuitRoutes(app: Express) {
  /** Processo pelo número em todas as fontes: processos dos CPFs/CNPJs das partes e DataJud. */
  app.post('/v1/compliance/lawsuits/search', requireJwt, async (req, res) => {
    const parsed = searchBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    let documents;
    try {
      documents = parsed.data.documents.map((d) => ({
        document: validateDocument(d.document, d.documentType),
        documentType: d.documentType,
      }));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }
    try {
      const result = await searchLawsuit({
        number: parsed.data.number,
        documents,
        requestedBy: (req as AuthedRequest).auth?.sub,
        forceRefresh: parsed.data.forceRefresh,
      });
      await logAudit({
        action: 'lawsuit_search',
        document: result.number,
        metadata: {
          found: result.found,
          movements: result.movements.length,
          forceRefresh: parsed.data.forceRefresh === true,
          sources: result.sources.map((s) => `${s.name}: ${s.status}`),
        },
      });
      res.json(result);
    } catch (e) {
      const status = e instanceof InvalidLawsuitNumberError ? 400 : 502;
      res.status(status).json({ error: (e as Error).message });
    }
  });
}
