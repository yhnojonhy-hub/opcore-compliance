import './load-env.js';

function parseCorsOrigins(): string[] {
  const multi = process.env.CORS_ORIGINS?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (multi && multi.length > 0) return multi;
  return ['http://localhost:5173'];
}

export const env = {
  port: Number(process.env.PORT ?? 3010),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  databaseUrl:
    process.env.DATABASE_URL ??
    'postgresql://compliance:compliance@127.0.0.1:5435/opcore_compliance',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-jwt-secret-change-me-min-32-chars-long',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
  corsOrigins: parseCorsOrigins(),
  cacheTtlDays: Number(process.env.CACHE_TTL_DAYS ?? 30),
  apiServiceKey: process.env.API_SERVICE_KEY ?? 'dev-api-service-key-change-me',
  defaultProviderSlug: process.env.DEFAULT_PROVIDER_SLUG?.trim() || undefined,
  bdcMaxTier: Number(process.env.BDC_MAX_TIER ?? 1),
  bdcConsultConcurrency: Number(process.env.BDC_CONSULT_CONCURRENCY ?? 5),
};
