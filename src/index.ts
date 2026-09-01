import './lib/load-env.js';
import express from 'express';
import cors from 'cors';
import { env } from './lib/env.js';
import { registerAuthRoutes } from './modules/auth/auth.routes.js';
import { registerProviderRoutes } from './modules/providers/providers.routes.js';
import {
  registerComplianceRoutes,
  registerRiskRuleRoutes,
} from './modules/compliance/compliance.routes.js';

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || env.corsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(null, false);
      },
      allowedHeaders: ['Authorization', 'Content-Type', 'X-API-Key'],
      credentials: true,
    }),
  );
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  registerAuthRoutes(app);
  registerProviderRoutes(app);
  registerComplianceRoutes(app);
  registerRiskRuleRoutes(app);

  return app;
}

const app = createApp();

if (process.env.VITEST !== 'true') {
  app.listen(env.port, () => {
    console.log(`opcore_compliance_api listening on http://localhost:${env.port}`);
  });
}

export default app;
