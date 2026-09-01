import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProviderConfig } from '../src/providers/provider.interface.js';

const seedsDir = join(dirname(fileURLToPath(import.meta.url)), 'seeds');

/** Seed JSON files upserted by prisma/seed.ts — single source for tests. */
export const PROVIDER_SEED_FILES = [
  'providers.mock.json',
  'providers/brasilapi-cnpj.json',
  'providers/brasilapi-cpf.json',
  'providers/lemit-cpf.json',
  'providers/lemit-cnpj.json',
] as const;

export type ProviderSeedFile = (typeof PROVIDER_SEED_FILES)[number];

export function loadProviderSeed(file: ProviderSeedFile): ProviderConfig {
  return JSON.parse(readFileSync(join(seedsDir, file), 'utf-8')) as ProviderConfig;
}

export function loadAllProviderSeeds(): ProviderConfig[] {
  return PROVIDER_SEED_FILES.map((file) => loadProviderSeed(file));
}
