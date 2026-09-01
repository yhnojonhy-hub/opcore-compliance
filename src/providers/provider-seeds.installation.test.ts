import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadAllProviderSeeds, PROVIDER_SEED_FILES } from '../../prisma/provider-seeds.manifest.js';
import { providerConfigSchema } from './provider-config.schema.js';
import { applyFieldMappings } from './provider.mapper.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');

const FIXTURE_EXEMPT_SLUGS = new Set(['mock-provider']);

function loadFixture(slug: string): unknown {
  const path = join(fixturesDir, `${slug}-response.json`);
  expect(existsSync(path), `fixture missing: ${slug}-response.json`).toBe(true);
  return JSON.parse(readFileSync(path, 'utf-8'));
}

describe('provider seeds installation', () => {
  const seeds = loadAllProviderSeeds();

  it('seed.ts manifest includes every provider seed file', () => {
    expect(PROVIDER_SEED_FILES.length).toBeGreaterThanOrEqual(5);
    expect(PROVIDER_SEED_FILES).toContain('providers/lemit-cpf.json');
    expect(PROVIDER_SEED_FILES).toContain('providers/lemit-cnpj.json');
  });

  it('has unique slugs', () => {
    const slugs = seeds.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it.each(seeds.map((s) => [s.slug, s] as const))(
    '%s passes ProviderConfig schema and installation checks',
    (slug, seed) => {
      const parsed = providerConfigSchema.parse(seed);

      expect(parsed.supportedTypes.length).toBeGreaterThan(0);

      if (parsed.authType === 'none' || parsed.authType === 'mock') {
        expect(parsed.authConfigRef ?? null).toBeNull();
      }
      if (parsed.authType === 'bearer' || parsed.authType === 'api_key_header') {
        expect(parsed.authConfigRef, `${slug} requires authConfigRef`).toBeTruthy();
      }

      if (
        parsed.httpMethod === 'GET' &&
        parsed.requestTemplate.path &&
        parsed.authType !== 'mock'
      ) {
        expect(parsed.requestTemplate.path).toContain('{{document}}');
      }

      if (!FIXTURE_EXEMPT_SLUGS.has(slug)) {
        const fixture = loadFixture(slug);
        const mapped = applyFieldMappings(fixture, parsed.fieldMappings);
        expect(Object.keys(mapped).length).toBeGreaterThan(0);
        expect(
          Object.keys(mapped).some((key) => key.startsWith('sections.')),
          `${slug} mappings must target sections.*`,
        ).toBe(true);
      }
    },
  );
});
