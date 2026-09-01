import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

if (existsSync('.env')) config({ path: '.env' });
if ((process.env.NODE_ENV ?? 'development') === 'development' && existsSync('.env.development')) {
  config({ path: '.env.development', override: true });
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url:
      process.env.DATABASE_URL ??
      'postgresql://compliance:compliance@127.0.0.1:5435/opcore_compliance',
  },
});
