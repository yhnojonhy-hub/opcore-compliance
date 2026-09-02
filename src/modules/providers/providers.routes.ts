import type { Express } from 'express';
import { requireJwt } from '../../middleware/auth.js';
import { providerConfigSchema } from '../../providers/provider-config.schema.js';
import {
  createProvider,
  getProviderBySlug,
  listActiveProviders,
  updateProvider,
} from '../../providers/provider.registry.js';

export function registerProviderRoutes(app: Express) {
  app.get('/v1/providers', requireJwt, async (_req, res) => {
    const providers = await listActiveProviders();
    res.json({ items: providers });
  });

  app.post('/v1/providers', requireJwt, async (req, res) => {
    const parsed = providerConfigSchema.safeParse(req.body);
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
    const parsed = providerConfigSchema.partial().safeParse(req.body);
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
