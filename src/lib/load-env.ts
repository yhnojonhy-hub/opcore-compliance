import { config } from 'dotenv';
import { existsSync } from 'node:fs';

if (existsSync('.env')) config({ path: '.env' });
if ((process.env.NODE_ENV ?? 'development') === 'development' && existsSync('.env.development')) {
  config({ path: '.env.development', override: true });
}
