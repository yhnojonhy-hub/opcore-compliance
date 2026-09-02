/**
 * Sync local provider seeds (BDC CPF/CNPJ + core) to production API.
 * Composites bigdatacorp-cpf / bigdatacorp-cnpj are forced inactive.
 *
 * Usage:
 *   PROD_API_URL=https://api.compliance.opcore.com.br \
 *   API_SERVICE_KEY=... \
 *   npx tsx scripts/sync-providers-prod.ts
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { providerConfigSchema } from '../src/providers/provider-config.schema.js';

const ROOT = join(process.cwd(), 'prisma/seeds/providers');
const BASE = (process.env.PROD_API_URL ?? 'https://api.compliance.opcore.com.br').replace(
  /\/$/,
  '',
);
const API_KEY = process.env.API_SERVICE_KEY ?? '';
const COMPOSITE_OFF = new Set(['bigdatacorp-cpf', 'bigdatacorp-cnpj']);
const CONCURRENCY = Number(process.env.SYNC_CONCURRENCY ?? 6);
/** When set (default 1 on prod sync), flatten `_bdcMeta.activationTier` so env `BDC_MAX_TIER=1` still consults full catalog. */
const FORCE_ACTIVATION_TIER = process.env.FORCE_BDC_TIER
  ? Number(process.env.FORCE_BDC_TIER)
  : null;

if (!API_KEY) {
  console.error('API_SERVICE_KEY required');
  process.exit(1);
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.json')) out.push(full);
  }
  return out;
}

type Seed = {
  slug: string;
  name: string;
  baseUrl: string;
  httpMethod: string;
  requestTemplate: Record<string, unknown>;
  authType: string;
  authConfigRef?: string | null;
  fieldMappings: Array<{ source: string; target: string }>;
  supportedTypes: string[];
  isActive: boolean;
  priority: number;
};

function loadCandidates(): Seed[] {
  const out: Seed[] = [];
  for (const file of walk(ROOT)) {
    let config: Seed;
    try {
      config = JSON.parse(readFileSync(file, 'utf-8')) as Seed;
    } catch {
      continue;
    }
    const slug = config.slug ?? '';
    const isBdc =
      file.includes(`${join('providers', 'bigdatacorp')}`) ||
      file.includes('/bigdatacorp/') ||
      slug.startsWith('bigdatacorp');
    const isCore =
      slug === 'lemit-cpf' ||
      slug === 'lemit-cnpj' ||
      slug === 'brasilapi-cpf' ||
      slug === 'brasilapi-cnpj';

    if (!isBdc && !isCore) continue;
    const types = config.supportedTypes ?? [];
    if (!types.includes('CPF') && !types.includes('CNPJ')) continue;

    if (COMPOSITE_OFF.has(slug)) {
      config = { ...config, isActive: false };
    } else if (!config.isActive) {
      continue;
    }

    if (
      FORCE_ACTIVATION_TIER != null &&
      !Number.isNaN(FORCE_ACTIVATION_TIER) &&
      config.requestTemplate &&
      typeof config.requestTemplate === 'object'
    ) {
      const rt = config.requestTemplate as {
        _bdcMeta?: { activationTier?: number; [k: string]: unknown };
        [k: string]: unknown;
      };
      if (rt._bdcMeta) {
        rt._bdcMeta = { ...rt._bdcMeta, activationTier: FORCE_ACTIVATION_TIER };
      }
    }

    const parsed = providerConfigSchema.safeParse(config);
    if (!parsed.success) {
      console.warn(`SKIP invalid ${slug}:`, parsed.error.issues[0]?.message);
      continue;
    }
    out.push(parsed.data as Seed);
  }
  return out;
}

async function getToken(): Promise<string> {
  const res = await fetch(`${BASE}/auth/token`, {
    method: 'POST',
    headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sub: 'sync-providers', service: 'activate' }),
  });
  if (!res.ok) throw new Error(`auth failed ${res.status}`);
  const json = (await res.json()) as { token: string };
  return json.token;
}

async function listSlugs(token: string): Promise<Set<string>> {
  const res = await fetch(`${BASE}/v1/providers`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`list providers ${res.status}`);
  const json = (await res.json()) as { items: Array<{ slug: string }> };
  return new Set((json.items ?? []).map((p) => p.slug));
}

async function upsert(
  token: string,
  existing: Set<string>,
  seed: Seed,
): Promise<'created' | 'updated' | 'error'> {
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  if (existing.has(seed.slug)) {
    const res = await fetch(`${BASE}/v1/providers/${encodeURIComponent(seed.slug)}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(seed),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`PUT fail ${seed.slug} ${res.status}: ${text.slice(0, 200)}`);
      return 'error';
    }
    return 'updated';
  }
  const res = await fetch(`${BASE}/v1/providers`, {
    method: 'POST',
    headers,
    body: JSON.stringify(seed),
  });
  if (!res.ok) {
    const text = await res.text();
    // race / already exists
    if (res.status === 409) {
      const put = await fetch(`${BASE}/v1/providers/${encodeURIComponent(seed.slug)}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(seed),
      });
      if (!put.ok) {
        console.error(`PUT after 409 fail ${seed.slug}`);
        return 'error';
      }
      return 'updated';
    }
    console.error(`POST fail ${seed.slug} ${res.status}: ${text.slice(0, 200)}`);
    return 'error';
  }
  return 'created';
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

async function main() {
  const seeds = loadCandidates();
  console.log(`Candidates: ${seeds.length} (composites forced OFF)`);
  const token = await getToken();
  let existing = await listSlugs(token);
  console.log(`Prod active/listed providers before: ${existing.size}`);

  // Ensure composites are deactivated even if not in candidates as active
  for (const slug of COMPOSITE_OFF) {
    if (!existing.has(slug) && !seeds.some((s) => s.slug === slug)) {
      // load from disk if present
      const file =
        slug === 'bigdatacorp-cpf'
          ? join(ROOT, 'bigdatacorp-cpf.json')
          : join(ROOT, 'bigdatacorp-cnpj.json');
      try {
        const raw = JSON.parse(readFileSync(file, 'utf-8')) as Seed;
        raw.isActive = false;
        seeds.push(providerConfigSchema.parse(raw) as Seed);
      } catch {
        /* ignore */
      }
    }
  }

  const stats = { created: 0, updated: 0, error: 0 };
  await mapPool(seeds, CONCURRENCY, async (seed) => {
    // refresh existence for creates — use local set
    const result = await upsert(token, existing, seed);
    if (result === 'created') {
      existing.add(seed.slug);
      stats.created += 1;
      console.log(`ON  CREATE ${seed.slug}`);
    } else if (result === 'updated') {
      stats.updated += 1;
      if (COMPOSITE_OFF.has(seed.slug)) console.log(`OFF UPDATE ${seed.slug}`);
      else if (stats.updated % 25 === 0) console.log(`… updated ${stats.updated}`);
    } else {
      stats.error += 1;
    }
  });

  existing = await listSlugs(token);
  const bdc = [...existing].filter((s) => s.startsWith('bigdatacorp'));
  console.log('\nDone', stats);
  console.log(`Prod listed after: ${existing.size} (bdc listed active: ${bdc.length})`);
  console.log(
    `Composites still listed active: ${COMPOSITE_OFF.has('bigdatacorp-cpf') && existing.has('bigdatacorp-cpf') ? 'cpf?' : 'ok'}`,
  );
  // listActiveProviders hides inactive — composites should disappear when OFF
  console.log(
    `composite cpf listed=${existing.has('bigdatacorp-cpf')} cnpj listed=${existing.has('bigdatacorp-cnpj')}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
