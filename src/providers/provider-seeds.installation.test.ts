import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ALL_PROVIDER_SEED_FILES,
  CORE_PROVIDER_SEED_FILES,
  loadAllProviderSeeds,
} from '../../prisma/provider-seeds.manifest.js';
import { providerConfigSchema } from './provider-config.schema.js';
import { applyFieldMappings } from './provider.mapper.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');

const FIXTURE_EXEMPT_SLUGS = new Set(['mock-provider']);

function isCatalogSeed(slug: string): boolean {
  return slug.startsWith('bigdatacorp-');
}

function isOsintSeed(slug: string): boolean {
  return slug.startsWith('osint-');
}

function hasFixture(slug: string): boolean {
  return existsSync(join(fixturesDir, `${slug}-response.json`));
}

function loadFixture(slug: string): unknown {
  const path = join(fixturesDir, `${slug}-response.json`);
  expect(existsSync(path), `fixture missing: ${slug}-response.json`).toBe(true);
  return JSON.parse(readFileSync(path, 'utf-8'));
}

describe('provider seeds installation', () => {
  const seeds = loadAllProviderSeeds();

  it('manifest includes core and catalog seeds', () => {
    expect(CORE_PROVIDER_SEED_FILES.length).toBeGreaterThanOrEqual(5);
    expect(ALL_PROVIDER_SEED_FILES.length).toBeGreaterThan(CORE_PROVIDER_SEED_FILES.length);
    expect(CORE_PROVIDER_SEED_FILES).toContain('providers/bigdatacorp-cnpj.json');
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

      if (
        parsed.authType === 'none' ||
        parsed.authType === 'mock' ||
        parsed.authType === 'env_headers'
      ) {
        expect(parsed.authConfigRef ?? null).toBeNull();
      }
      if (parsed.authType === 'bearer' || parsed.authType === 'api_key_header') {
        expect(parsed.authConfigRef, `${slug} requires authConfigRef`).toBeTruthy();
      }
      if (parsed.authType === 'env_headers') {
        const headerValues = Object.values(parsed.requestTemplate.headers ?? {});
        expect(
          headerValues.some((v) => v.startsWith('env:')),
          `${slug} env_headers requires at least one env: header value`,
        ).toBe(true);
      }

      if (
        parsed.httpMethod === 'GET' &&
        parsed.requestTemplate.path &&
        parsed.authType !== 'mock' &&
        !isOsintSeed(slug)
      ) {
        expect(parsed.requestTemplate.path).toContain('{{document}}');
      }

      if (
        parsed.httpMethod === 'POST' &&
        parsed.authType !== 'mock' &&
        !isOsintSeed(slug) &&
        !isCatalogSeed(slug)
      ) {
        const body = parsed.requestTemplate.body as Record<string, unknown> | undefined;
        const bodyHasDocument =
          body != null &&
          Object.values(body).some((v) => typeof v === 'string' && v.includes('{{document}}'));
        const pathHasDocument = parsed.requestTemplate.path?.includes('{{document}}') ?? false;
        expect(
          bodyHasDocument || pathHasDocument,
          `${slug} POST must include {{document}} in path or body`,
        ).toBe(true);
      }

      if (isOsintSeed(slug)) {
        expect(parsed.requestTemplate._providerMeta?.adapterRef).toBe(slug);
        expect(parsed.requestTemplate._providerMeta?.outputMode).toBe('findings');
      }

      const needsFixture =
        !FIXTURE_EXEMPT_SLUGS.has(slug) &&
        !isOsintSeed(slug) &&
        (!isCatalogSeed(slug) || hasFixture(slug));

      if (needsFixture) {
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
