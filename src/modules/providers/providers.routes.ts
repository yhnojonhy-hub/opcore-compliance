import type { Express } from 'express';
import { z } from 'zod';
import { requireJwt } from '../../middleware/auth.js';
import {
  createProvider,
  getProviderBySlug,
  listActiveProviders,
  updateProvider,
} from '../../providers/provider.registry.js';

const providerSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  baseUrl: z.string().min(1),
  httpMethod: z.string().min(1),
  requestTemplate: z.record(z.string(), z.unknown()),
  authType: z.string().min(1),
  authConfigRef: z.string().nullable().optional(),
  fieldMappings: z.array(z.object({ source: z.string(), target: z.string() })),
  supportedTypes: z.array(z.enum(['CPF', 'CNPJ'])),
  isActive: z.boolean().default(true),
  priority: z.number().int().default(100),
});

export function registerProviderRoutes(app: Express) {
  app.get('/v1/providers', requireJwt, async (_req, res) => {
    const providers = await listActiveProviders();
    res.json({ items: providers });
  });

  app.post('/v1/providers', requireJwt, async (req, res) => {
    const parsed = providerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const existing = await getProviderBySlug(parsed.data.slug);
    if (existing) {
      res.status(409).json({ error: 'Provedor já existe' });
      return;
    }
    const provider = await createProvider(parsed.data);
    res.status(201).json(provider);
  });

  app.put('/v1/providers/:slug', requireJwt, async (req, res) => {
    const parsed = providerSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const existing = await getProviderBySlug(req.params.slug);
    if (!existing) {
      res.status(404).json({ error: 'Provedor não encontrado' });
      return;
    }
    const provider = await updateProvider(req.params.slug, parsed.data);
    res.json(provider);
  });
}
