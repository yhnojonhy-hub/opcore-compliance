import type { Express } from 'express';
import { requireJwt } from '../../middleware/auth.js';
import { getProviderBillingOverview } from '../../billing/billing.service.js';

export function registerBillingRoutes(app: Express) {
  /** Saldo/consumo/status de cobrança dos provedores pagos (BDC, Lemit, Apollo). */
  app.get('/v1/billing/providers', requireJwt, async (_req, res) => {
    try {
      res.json(await getProviderBillingOverview());
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });
}
