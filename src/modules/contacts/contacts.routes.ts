import type { Express } from 'express';
import { z } from 'zod';
import type { AuthedRequest } from '../../middleware/auth.js';
import { requireJwt } from '../../middleware/auth.js';
import { ProviderHttpError } from '../../providers/provider.errors.js';
import { logAudit } from '../compliance/compliance.service.js';
import { primaryPhoneNumber, resolvePhone } from './resolve-phone.service.js';

const bodySchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional().nullable(),
});

function errorStatus(e: unknown): number {
  if (e instanceof ProviderHttpError) return 502;
  if (e instanceof Error && /não configurado/i.test(e.message)) return 503;
  return 422;
}

export function registerContactsRoutes(app: Express) {
  /**
   * RF12 — BDC name+email → CPF → Lemit → BDC phones_extended.
   * Does not reveal Apollo phones.
   */
  app.post('/v1/contacts/resolve-phone', requireJwt, async (req, res) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    try {
      const result = await resolvePhone({
        name: parsed.data.name,
        email: parsed.data.email,
      });

      await logAudit({
        action: 'resolve_phone',
        document: result.document ?? parsed.data.email ?? parsed.data.name,
        metadata: {
          source: result.source,
          phoneCount: result.phones.length,
          requestedBy: (req as AuthedRequest).auth?.sub,
          hasEmail: Boolean(parsed.data.email),
        },
      });

      res.json({
        document: result.document,
        phones: result.phones,
        source: result.source,
        primaryPhone: primaryPhoneNumber(result.phones),
      });
    } catch (e) {
      res.status(errorStatus(e)).json({ error: (e as Error).message });
    }
  });
}
