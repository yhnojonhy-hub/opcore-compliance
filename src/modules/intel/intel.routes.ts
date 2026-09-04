import type { Express } from 'express';
import { z } from 'zod';
import { TARGET_TYPES } from '../../contracts/enums/intel.enums.js';
import { pruneEmptyDeep } from '../../contracts/utils/prune.util.js';
import type { AuthedRequest } from '../../middleware/auth.js';
import { requireJwt } from '../../middleware/auth.js';
import {
  buildFullComplianceDossier,
  createIntelDossier,
  getIntelCanonicalDossier,
  getIntelDossier,
  listIntelDossiers,
  regenerateIntelDossier,
} from './intel.service.js';

const createBodySchema = z.object({
  target: z.string().min(1),
  targetType: z.enum(TARGET_TYPES),
  deepSearch: z.boolean().optional(),
  purpose: z.string().optional(),
  legalBasis: z.string().optional(),
  paidProviders: z.array(z.string()).optional(),
  partyName: z.string().optional(),
  tenantId: z.string().optional(),
  includeBureau: z.boolean().optional(),
  forceRefresh: z.boolean().optional(),
  async: z.boolean().optional(),
});

export function registerIntelRoutes(app: Express) {
  app.post('/v1/intel-dossiers', requireJwt, async (req, res) => {
    const parsed = createBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const result = await createIntelDossier({
        ...parsed.data,
        purpose: parsed.data.purpose as CreateIntelDossierInput['purpose'],
        legalBasis: parsed.data.legalBasis as CreateIntelDossierInput['legalBasis'],
        requestedBy: (req as AuthedRequest).auth?.sub,
      });
      res.status(parsed.data.async ? 202 : 201).json(result);
    } catch (e) {
      res.status(422).json({ error: (e as Error).message });
    }
  });

  app.get('/v1/intel-dossiers', requireJwt, async (req, res) => {
    const result = await listIntelDossiers({
      target: req.query.target as string | undefined,
      targetType: req.query.targetType as ListTargetType | undefined,
      status: req.query.status as string | undefined,
      skip: req.query.skip ? Number(req.query.skip) : undefined,
      take: req.query.take ? Number(req.query.take) : undefined,
    });
    res.json(result);
  });

  app.get('/v1/intel-dossiers/:id', requireJwt, async (req, res) => {
    const poll = req.query.poll === '1';
    let dossier = await getIntelDossier(req.params.id);
    if (!dossier) {
      res.status(404).json({ error: 'Dossiê intel não encontrado' });
      return;
    }
    if (poll && dossier.status === 'PENDING') {
      await new Promise((r) => setTimeout(r, 500));
      dossier = (await getIntelDossier(req.params.id)) ?? dossier;
    }
    res.json(dossier);
  });

  app.get('/v1/intel-dossiers/:id/canonical', requireJwt, async (req, res) => {
    try {
      const canonical = await getIntelCanonicalDossier(req.params.id);
      if (!canonical) {
        res.status(404).json({ error: 'Dossiê intel não encontrado' });
        return;
      }
      res.json(
        pruneEmptyDeep(canonical, { preserveKeys: ['meta', 'subject', 'risk', 'compliance'] }),
      );
    } catch (e) {
      res.status(422).json({ error: (e as Error).message });
    }
  });

  app.post('/v1/intel-dossiers/:id/regenerate', requireJwt, async (req, res) => {
    try {
      const asyncMode = req.body?.async === true || req.query.async === '1';
      const result = await regenerateIntelDossier(req.params.id, (req as AuthedRequest).auth?.sub, {
        async: asyncMode,
      });
      res.status(asyncMode ? 202 : 200).json(result);
    } catch (e) {
      const message = (e as Error).message;
      res.status(message.includes('não encontrado') ? 404 : 422).json({ error: message });
    }
  });
}

export function registerFullDossierRoute(app: Express) {
  app.get('/v1/compliance/dossier/:document/full', requireJwt, async (req, res) => {
    const documentType = (req.query.documentType as 'CPF' | 'CNPJ') ?? 'CNPJ';
    const deepSearch = req.query.deepSearch === '1' || req.query.deepSearch === 'true';
    try {
      const result = await buildFullComplianceDossier({
        document: req.params.document,
        documentType,
        deepSearch,
        requestedBy: (req as AuthedRequest).auth?.sub,
      });
      res.json(
        pruneEmptyDeep(result, {
          preserveKeys: ['meta', 'subject', 'risk', 'compliance', 'intel'],
        }),
      );
    } catch (e) {
      res.status(422).json({ error: (e as Error).message });
    }
  });
}

// Local types to avoid circular import noise in route file
type CreateIntelDossierInput =
  import('../../contracts/types/intel-dossier.types.js').CreateIntelDossierInput;
type ListTargetType = import('../../contracts/enums/intel.enums.js').TargetType;
