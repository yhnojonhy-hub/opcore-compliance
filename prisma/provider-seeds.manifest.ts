import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProviderConfig } from '../src/providers/provider.interface.js';
import { BIGDATACORP_SEED_FILES } from './bigdatacorp-seeds.manifest.js';
import { OSINT_SEED_FILES } from './osint-seeds.manifest.js';

const seedsDir = join(dirname(fileURLToPath(import.meta.url)), 'seeds');

/** Core provider seed JSON files (always loaded in tests). */
export const CORE_PROVIDER_SEED_FILES = [
  'providers.mock.json',
  'providers/brasilapi-cnpj.json',
  'providers/brasilapi-cpf.json',
  'providers/bigdatacorp-cnpj.json',
  'providers/bigdatacorp-cpf.json',
  'providers/lemit-cpf.json',
  'providers/lemit-cnpj.json',
] as const;

/** @deprecated Use CORE_PROVIDER_SEED_FILES or ALL_PROVIDER_SEED_FILES */
export const PROVIDER_SEED_FILES = CORE_PROVIDER_SEED_FILES;

export type CoreProviderSeedFile = (typeof CORE_PROVIDER_SEED_FILES)[number];
export type ProviderSeedFile =
  | CoreProviderSeedFile
  | (typeof BIGDATACORP_SEED_FILES)[number]
  | (typeof OSINT_SEED_FILES)[number];

export const ALL_PROVIDER_SEED_FILES = [
  ...CORE_PROVIDER_SEED_FILES,
  ...BIGDATACORP_SEED_FILES,
  ...OSINT_SEED_FILES,
] as const;

export function loadProviderSeed(file: ProviderSeedFile): ProviderConfig {
  return JSON.parse(readFileSync(join(seedsDir, file), 'utf-8')) as ProviderConfig;
}

export function loadAllProviderSeeds(): ProviderConfig[] {
  return ALL_PROVIDER_SEED_FILES.map((file) => loadProviderSeed(file));
}
