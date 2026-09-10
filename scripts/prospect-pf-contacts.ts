/**
 * One-shot: Apollo search (CRM ICPs) + people/match for e-mail/LinkedIn.
 * Telefone cadastral is Lemit via OpCore (PRD RF11) — never reveal_phone_number.
 * Writes CSV in the format /leads importCSV expects. Does not insert into CRM.
 *
 * Usage (from api/): npx tsx scripts/prospect-pf-contacts.ts
 */
import { config } from 'dotenv';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

config({ path: join(dirname(fileURLToPath(import.meta.url)), '../.env') });

const APOLLO_BASE = 'https://api.apollo.io/api/v1';
const PER_BUCKET = 15;
const SEARCH_PAGES = 4;
const MATCH_CONCURRENCY = 2;
const DELAY_MS = 220;
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../tmp/prospeccao');
const CSV_PATH = join(OUT_DIR, 'pf-60-contatos.csv');
const JSON_PATH = join(OUT_DIR, 'pf-60-contatos.json');
const CSV_120_PATH = join(OUT_DIR, 'pf-120-contatos.csv');
const JSON_120_PATH = join(OUT_DIR, 'pf-120-contatos.json');

type BucketId = 'financeiro' | 'diretoria' | 'medicos' | 'empresarios';

interface IcpBucket {
  id: BucketId;
  label: string;
  titles: string[];
  keywords: string[];
}

const BUCKETS: IcpBucket[] = [
  {
    id: 'financeiro',
    label: 'Financeiro CRM',
    titles: [
      'tesoureiro',
      'head de tesouraria',
      'CIO',
      'gestor de investimentos',
      'CFO',
      'diretor financeiro',
      'family officer',
    ],
    keywords: ['FIDC', 'gestora', 'asset', 'family office', 'securitizadora'],
  },
  {
    id: 'diretoria',
    label: 'Diretoria',
    titles: ['CEO', 'diretor', 'presidente', 'conselheiro', 'diretor-presidente'],
    keywords: ['holding', 'grupo empresarial', 'conglomerado'],
  },
  {
    id: 'medicos',
    label: 'Médicos',
    titles: [
      'médico',
      'diretor clínico',
      'diretor médico',
      'gestor hospitalar',
      'coordenador médico',
    ],
    keywords: ['hospital', 'clínica', 'saúde', 'laboratório'],
  },
  {
    id: 'empresarios',
    label: 'Empresários',
    titles: ['sócio', 'proprietário', 'founder', 'CEO', 'presidente', 'dono'],
    keywords: ['holding', 'grupo empresarial', 'empresário', 'investimentos'],
  },
];

interface Person {
  id: string;
  name: string;
  title?: string;
  email?: string;
  emailStatus?: string;
  phone?: string;
  linkedinUrl?: string;
  city?: string;
  state?: string;
  country?: string;
  organizationName?: string;
  organizationDomain?: string;
  hasEmail?: boolean;
  hasPhone?: boolean;
}

interface LeadRow {
  bucket: BucketId;
  bucketLabel: string;
  cliente: string;
  email: string;
  telefone: string;
  produto: string;
  campanha: string;
  observacoes: string;
  origem: 'apollo';
  estagio: 'Novo lead';
  valor: 0;
  probabilidade: 0;
  apolloId: string;
  linkedinUrl: string;
  cidade: string;
  complete: boolean;
}

function apiKey(): string {
  const key = process.env.APOLLO_API_KEY?.trim();
  if (!key) throw new Error('APOLLO_API_KEY ausente em opcore-compliance/api/.env');
  return key;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapPerson(raw: Record<string, unknown>): Person | null {
  const id = asText(raw.id);
  if (!id) return null;
  const org =
    raw.organization && typeof raw.organization === 'object'
      ? (raw.organization as Record<string, unknown>)
      : {};
  const phones = Array.isArray(raw.phone_numbers) ? raw.phone_numbers : [];
  const firstPhone = phones.find((p) => p && typeof p === 'object') as
    | Record<string, unknown>
    | undefined;
  const name =
    asText(raw.name) || [asText(raw.first_name), asText(raw.last_name)].filter(Boolean).join(' ');
  if (!name) return null;
  return {
    id,
    name,
    title: asText(raw.title) || undefined,
    email: asText(raw.email) || undefined,
    emailStatus: asText(raw.email_status) || undefined,
    phone:
      asText(firstPhone?.sanitized_number) ||
      asText(firstPhone?.raw_number) ||
      asText(raw.phone) ||
      undefined,
    linkedinUrl: asText(raw.linkedin_url) || undefined,
    city: asText(raw.city) || undefined,
    state: asText(raw.state) || undefined,
    country: asText(raw.country) || undefined,
    organizationName: asText(org.name) || undefined,
    organizationDomain: asText(org.primary_domain) || asText(org.website_url) || undefined,
    hasEmail: Boolean(raw.has_email) || Boolean(asText(raw.email)),
    hasPhone: Boolean(raw.has_direct_phone) || Boolean(firstPhone),
  };
}

async function apolloFetch(
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; text: string; json: Record<string, unknown> }> {
  const res = await fetch(`${APOLLO_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Cache-Control': 'no-cache',
      'x-api-key': apiKey(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = { message: text.slice(0, 240) };
  }
  return { status: res.status, text, json };
}

async function apolloPost(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await apolloFetch('POST', path, body);
  if (result.status >= 400) {
    const msg = asText(result.json.error) || asText(result.json.message) || `HTTP ${result.status}`;
    throw new Error(msg.slice(0, 240));
  }
  return result.json;
}

async function searchPage(bucket: IcpBucket, page: number): Promise<Person[]> {
  const json = await apolloPost('/mixed_people/api_search', {
    page,
    per_page: 25,
    person_locations: ['Brazil'],
    person_titles: bucket.titles,
    q_organization_keyword_tags: bucket.keywords,
  });
  const rows = Array.isArray(json.people) ? json.people : [];
  return rows
    .map((row) => (row && typeof row === 'object' ? mapPerson(row as Record<string, unknown>) : null))
    .filter((p): p is Person => Boolean(p));
}

function rank(person: Person): number {
  return (person.hasEmail ? 4 : 0) + (person.hasPhone ? 2 : 0) + (person.linkedinUrl ? 1 : 0);
}

function mergePerson(base: Person, extra: Person | null): Person {
  if (!extra) return base;
  return {
    ...base,
    ...extra,
    email: extra.email || base.email,
    phone: extra.phone || base.phone,
    linkedinUrl: extra.linkedinUrl || base.linkedinUrl,
    title: extra.title || base.title,
    organizationName: extra.organizationName || base.organizationName,
    organizationDomain: extra.organizationDomain || base.organizationDomain,
    city: extra.city || base.city,
    state: extra.state || base.state,
    country: extra.country || base.country,
    emailStatus: extra.emailStatus || base.emailStatus,
  };
}

async function matchPerson(fallback: Person): Promise<Person> {
  const json = await apolloPost('/people/match', {
    id: fallback.id,
    reveal_personal_emails: true,
    reveal_phone_number: false,
  });
  const raw = (
    json.person && typeof json.person === 'object' ? json.person : json
  ) as Record<string, unknown>;
  return mergePerson(fallback, mapPerson(raw));
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      out[current] = await fn(items[current]);
      await sleep(DELAY_MS);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) || 1 }, () => worker()));
  return out;
}

function csvCell(value: string | number): string {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function notes(person: Person): string {
  return [
    person.linkedinUrl ? `LinkedIn: ${person.linkedinUrl}` : '',
    [person.city, person.state, person.country].filter(Boolean).join(', '),
    person.organizationDomain ? `Domínio: ${person.organizationDomain}` : '',
    person.emailStatus ? `E-mail Apollo: ${person.emailStatus}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

function toRow(bucket: IcpBucket, person: Person): LeadRow {
  const email = person.email ?? '';
  const telefone = person.phone ?? '';
  const linkedinUrl = person.linkedinUrl ?? '';
  return {
    bucket: bucket.id,
    bucketLabel: bucket.label,
    cliente: person.name,
    email,
    telefone,
    produto: person.organizationName ?? '',
    campanha: person.title ?? bucket.label,
    observacoes: notes(person),
    origem: 'apollo',
    estagio: 'Novo lead',
    valor: 0,
    probabilidade: 0,
    apolloId: person.id,
    linkedinUrl,
    cidade: [person.city, person.state].filter(Boolean).join(', '),
    complete: Boolean(email && telefone && linkedinUrl),
  };
}

function buildCsv(rows: LeadRow[]): string {
  const title = 'Prospecção PF';
  const subtitle = `Leads Apollo — ${new Date().toISOString().slice(0, 10)}`;
  const header = [
    'ID',
    'Vendedor',
    'Cliente',
    'Email',
    'Telefone',
    'Produto',
    'Valor',
    'Estágio',
    'Probabilidade',
    'Data Fechamento',
    'Comissão',
    'Observações',
    'Status',
    'Origem',
    'Campanha',
  ].join(',');
  const data = rows.map((row) =>
    [
      '',
      '',
      csvCell(row.cliente),
      csvCell(row.email),
      csvCell(row.telefone),
      csvCell(row.produto),
      row.valor,
      csvCell(row.estagio),
      row.probabilidade,
      '',
      0,
      csvCell(row.observacoes),
      '',
      csvCell(row.origem),
      csvCell(row.campanha),
    ].join(','),
  );
  return [title, subtitle, header, ...data].join('\n') + '\n';
}

async function fillBucket(
  bucket: IcpBucket,
  seen: Set<string>,
  pages = SEARCH_PAGES,
  existingEmails?: Set<string>,
): Promise<LeadRow[]> {
  const candidates: Person[] = [];
  for (let page = 1; page <= pages; page += 1) {
    const people = await searchPage(bucket, page);
    await sleep(DELAY_MS);
    for (const person of people) {
      if (seen.has(person.id)) continue;
      seen.add(person.id);
      candidates.push(person);
    }
    if (candidates.length >= PER_BUCKET * 4) break;
  }
  candidates.sort((a, b) => rank(b) - rank(a));
  const toMatch = candidates.slice(0, Math.min(candidates.length, PER_BUCKET + 8));
  console.log(`  ${bucket.label}: ${candidates.length} novos na busca, revelando ${toMatch.length}…`);

  const matched = await mapLimit(toMatch, MATCH_CONCURRENCY, async (person) => {
    try {
      return await matchPerson(person);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  match falhou ${person.name}: ${msg.slice(0, 120)}`);
      return person;
    }
  });

  const complete: LeadRow[] = [];
  const partial: LeadRow[] = [];
  for (const person of matched) {
    const row = toRow(bucket, person);
    if (!row.email && !row.telefone && !row.linkedinUrl) continue;
    if (row.email && existingEmails?.has(row.email.toLowerCase())) continue;
    if (row.email && row.telefone) complete.push(row);
    else partial.push(row);
  }
  return [...complete, ...partial].slice(0, PER_BUCKET);
}

function writeOutput(rows: LeadRow[]) {
  mkdirSync(OUT_DIR, { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    source: 'apollo search + people/match (email/linkedin; phones via Lemit/OpCore)',
    count: rows.length,
    complete: rows.filter((r) => r.complete).length,
    withEmail: rows.filter((r) => r.email).length,
    withPhone: rows.filter((r) => r.telefone).length,
    withLinkedin: rows.filter((r) => r.linkedinUrl).length,
    rows,
  };
  const json = JSON.stringify(payload, null, 2);
  writeFileSync(CSV_PATH, buildCsv(rows), 'utf8');
  writeFileSync(JSON_PATH, json, 'utf8');
  if (rows.length >= 120) {
    writeFileSync(CSV_120_PATH, buildCsv(rows), 'utf8');
    writeFileSync(JSON_120_PATH, json, 'utf8');
  }
}

async function enrichPhones(rows: LeadRow[]): Promise<LeadRow[]> {
  console.log(
    'Telefone não vem da Apollo (PRD RF11). Use Lemit via OpCore Compliance com CPF/CNPJ.',
  );
  return rows;
}

async function backfillIncomplete(rows: LeadRow[]): Promise<LeadRow[]> {
  const seen = new Set(rows.map((row) => row.apolloId));
  const out = [...rows];
  for (const bucket of BUCKETS) {
    const slots = out
      .map((row, index) => ({ row, index }))
      .filter((item) => item.row.bucket === bucket.id && !item.row.complete);
    if (slots.length === 0) continue;
    const candidates: Person[] = [];
    for (let page = 1; page <= 6; page += 1) {
      const people = await searchPage(bucket, page);
      await sleep(DELAY_MS);
      for (const person of people) {
        if (seen.has(person.id)) continue;
        seen.add(person.id);
        candidates.push(person);
      }
      if (candidates.length >= slots.length * 4) break;
    }
    candidates.sort((a, b) => rank(b) - rank(a));
    const extras: LeadRow[] = [];
    for (const person of candidates.slice(0, slots.length * 3)) {
      if (extras.length >= slots.length) break;
      let enriched = person;
      try {
        enriched = await matchPerson(person);
      } catch {
        continue;
      }
      let row = toRow(bucket, enriched);
      if (!row.email || !row.linkedinUrl) continue;
      extras.push(row);
    }
    for (let i = 0; i < extras.length; i += 1) {
      out[slots[i].index] = extras[i];
    }
    console.log(`  backfill ${bucket.label}: ${extras.length}/${slots.length} trocas`);
  }
  return out;
}

async function main() {
  apiKey();
  mkdirSync(OUT_DIR, { recursive: true });
  const phonesOnly = process.argv.includes('--phones-only');
  const backfill = process.argv.includes('--backfill');
  const append = process.argv.includes('--append');
  let rows: LeadRow[] = [];
  if (phonesOnly || backfill) {
    const parsed = JSON.parse(readFileSync(JSON_PATH, 'utf8')) as { rows: LeadRow[] };
    rows = parsed.rows;
  } else if (append) {
    const parsed = JSON.parse(readFileSync(JSON_PATH, 'utf8')) as { rows: LeadRow[] };
    const existing = parsed.rows;
    const seen = new Set(existing.map((row) => row.apolloId));
    const emails = new Set(
      existing.map((row) => row.email.toLowerCase()).filter((email) => email.includes('@')),
    );
    const added: LeadRow[] = [];
    for (const bucket of BUCKETS) {
      const filled = await fillBucket(bucket, seen, 8, emails);
      added.push(...filled);
      for (const row of filled) {
        if (row.email) emails.add(row.email.toLowerCase());
      }
      console.log(
        `  ${bucket.label}: +${filled.length} (${filled.filter((r) => r.complete).length} já com e-mail+tel na busca)`,
      );
    }
    const withPhones = await enrichPhones(added);
    rows = [...existing, ...withPhones];
  } else {
    const seen = new Set<string>();
    for (const bucket of BUCKETS) {
      const filled = await fillBucket(bucket, seen);
      rows.push(...filled);
      console.log(
        `  ${bucket.label}: ${filled.length} na lista (${filled.filter((r) => r.complete).length} com e-mail+tel+LinkedIn)`,
      );
    }
  }
  if (!backfill && !append) {
    rows = await enrichPhones(rows);
  }
  if (backfill) {
    rows = await backfillIncomplete(rows);
  }
  writeOutput(rows);
  console.log(
    `OK ${rows.length} leads · ${rows.filter((r) => r.telefone).length} com telefone · ${rows.filter((r) => r.complete).length} completos → ${rows.length >= 120 ? CSV_120_PATH : CSV_PATH}`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
