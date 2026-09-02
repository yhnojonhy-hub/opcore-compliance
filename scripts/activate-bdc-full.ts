/**
 * Activate full BigDataCorp catalog for CPF/CNPJ dossiers.
 * Composite bigdatacorp-cpf / bigdatacorp-cnpj stay inactive to avoid double billing.
 *
 * Usage: npx tsx scripts/activate-bdc-full.ts
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(process.cwd(), 'prisma/seeds/providers');
const COMPOSITE_OFF = new Set(['bigdatacorp-cpf', 'bigdatacorp-cnpj']);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.json')) out.push(full);
  }
  return out;
}

function isBdcSeed(path: string, slug: string): boolean {
  const rel = relative(ROOT, path).replace(/\\/g, '/');
  return rel.startsWith('bigdatacorp/') || slug.startsWith('bigdatacorp');
}

let activated = 0;
let deactivated = 0;
let skipped = 0;

for (const file of walk(ROOT)) {
  const raw = readFileSync(file, 'utf-8');
  let config: {
    slug?: string;
    isActive?: boolean;
    supportedTypes?: string[];
  };
  try {
    config = JSON.parse(raw) as typeof config;
  } catch {
    skipped += 1;
    continue;
  }
  const slug = config.slug ?? '';
  if (!isBdcSeed(file, slug)) {
    skipped += 1;
    continue;
  }
  const types = config.supportedTypes ?? [];
  if (!types.includes('CPF') && !types.includes('CNPJ')) {
    skipped += 1;
    continue;
  }

  const wantActive = !COMPOSITE_OFF.has(slug);
  if (config.isActive === wantActive) {
    skipped += 1;
    continue;
  }
  config.isActive = wantActive;
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  if (wantActive) activated += 1;
  else deactivated += 1;
  console.log(`${wantActive ? 'ON ' : 'OFF'} ${slug}`);
}

console.log(
  `\nDone. activated=${activated} deactivated=${deactivated} unchanged/skipped=${skipped}`,
);
