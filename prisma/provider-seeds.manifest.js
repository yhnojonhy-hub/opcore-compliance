import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
];
/** @deprecated Use CORE_PROVIDER_SEED_FILES or ALL_PROVIDER_SEED_FILES */
export const PROVIDER_SEED_FILES = CORE_PROVIDER_SEED_FILES;
export const ALL_PROVIDER_SEED_FILES = [
  ...CORE_PROVIDER_SEED_FILES,
  ...BIGDATACORP_SEED_FILES,
  ...OSINT_SEED_FILES,
];
export function loadProviderSeed(file) {
  return JSON.parse(readFileSync(join(seedsDir, file), 'utf-8'));
}
export function loadAllProviderSeeds() {
  return ALL_PROVIDER_SEED_FILES.map((file) => loadProviderSeed(file));
}
//# sourceMappingURL=provider-seeds.manifest.js.map
