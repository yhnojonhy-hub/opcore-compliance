import type { Express } from 'express';
import { z } from 'zod';
import { requireApiKey, signJwt } from '../../middleware/auth.js';

const tokenBodySchema = z.object({
  sub: z.string().min(1),
  service: z.string().min(1),
});

export function registerAuthRoutes(app: Express) {
  app.post('/auth/token', requireApiKey, (req, res) => {
    const parsed = tokenBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const token = signJwt(parsed.data);
    res.json({ token, expiresIn: process.env.JWT_EXPIRES_IN ?? '8h' });
  });
}
