import { getEnv } from '../../../lib/intel-env.js';
import { isValidEmail } from '../../../contracts/utils/document.util.js';
import { asRecord, fetchJson } from '../http.util.js';
import type {
  DossierProvider,
  ProviderContext,
  ProviderFinding,
  ProviderResult,
} from '../types.js';

const APOLLO_BASE = 'https://api.apollo.io/api/v1';
const DEFAULT_MAX_MATCHES = 8;

export interface ApolloSeed {
  name?: string;
  email?: string;
  organizationName?: string;
  domain?: string;
}

export interface ApolloPersonMapped {
  id: string;
  name: string;
  firstName?: string;
  lastName?: string;
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
}

function skipped(reason: string): ProviderResult {
  return { status: 'skipped', error: reason, findings: [] };
}

function ok(findings: ProviderFinding[], rawPayload?: unknown, httpStatus = 200): ProviderResult {
  return { status: 'ok', httpStatus, rawPayload, findings };
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function domainFromEmail(email: string): string | undefined {
  const at = email.lastIndexOf('@');
  if (at < 0) return undefined;
  const host = email
    .slice(at + 1)
    .toLowerCase()
    .trim();
  if (!host || host.includes('gmail.') || host.includes('hotmail.') || host.includes('yahoo.')) {
    return undefined;
  }
  if (!host.includes('.')) return undefined;
  return host;
}

function normalizeDomain(raw: string): string | undefined {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^www\./, '');
  if (!cleaned || !cleaned.includes('.')) return undefined;
  return cleaned;
}

function pushUniqueSeed(seeds: ApolloSeed[], seed: ApolloSeed): void {
  const name = seed.name?.trim();
  const email = seed.email?.trim().toLowerCase();
  const organizationName = seed.organizationName?.trim();
  const domain = seed.domain ? normalizeDomain(seed.domain) : undefined;
  if (!name && !email) return;
  if (name && !email && !isPersonLikeName(name)) return;
  const key = `${(email ?? '').toLowerCase()}|${(name ?? '').toLowerCase()}|${(domain ?? '').toLowerCase()}`;
  if (
    seeds.some(
      (item) =>
        `${(item.email ?? '').toLowerCase()}|${(item.name ?? '').toLowerCase()}|${(item.domain ?? '').toLowerCase()}` ===
        key,
    )
  ) {
    return;
  }
  seeds.push({
    name: name || undefined,
    email: email && isValidEmail(email) ? email : undefined,
    organizationName: organizationName || undefined,
    domain,
  });
}

const NON_PERSON_TITLE_RE =
  /contatos|cadastral|consultado|v[ií]nculo|participa[cç][aã]o|quadro societ|nada consta|protesto|san[cç][aã]o|processo/i;

function isPersonLikeName(value: string): boolean {
  const text = value.trim();
  if (text.length < 5 || /^\d+$/.test(text)) return false;
  if (NON_PERSON_TITLE_RE.test(text)) return false;
  const parts = text.split(/\s+/).filter(Boolean);
  return parts.length >= 2 && /[A-Za-zÀ-ÿ]/.test(text);
}

function readPersonName(record: Record<string, unknown>): string | undefined {
  const name = asText(
    record.name ??
      record.nome ??
      record.nome_socio ??
      record.Name ??
      record.fullName ??
      record.razao_social,
  );
  return name.length > 2 ? name : undefined;
}

function collectFromList(seeds: ApolloSeed[], items: unknown, orgHint?: string): void {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    const record = asRecord(item);
    const name = readPersonName(record);
    const emailRaw = asText(record.email ?? record.Email ?? record.address);
    const email = emailRaw && isValidEmail(emailRaw) ? emailRaw.toLowerCase() : undefined;
    pushUniqueSeed(seeds, {
      name,
      email,
      organizationName: orgHint,
      domain: email ? domainFromEmail(email) : undefined,
    });
  }
}

/**
 * Collect Apollo enrichment seeds from prior findings / party context.
 * Exported for unit tests.
 */
export function collectApolloSeeds(
  ctx: Pick<ProviderContext, 'target' | 'targetType' | 'partyName' | 'aliases' | 'priorFindings'>,
  options?: { organizationName?: string; max?: number },
): ApolloSeed[] {
  const max = options?.max ?? DEFAULT_MAX_MATCHES;
  const seeds: ApolloSeed[] = [];
  const orgHint =
    options?.organizationName ??
    (ctx.targetType === 'CNPJ' ? (ctx.partyName ?? undefined) : undefined);

  if (ctx.targetType === 'EMAIL' && isValidEmail(ctx.target)) {
    pushUniqueSeed(seeds, {
      email: ctx.target.trim().toLowerCase(),
      name: ctx.partyName,
      organizationName: orgHint,
      domain: domainFromEmail(ctx.target),
    });
  }

  if (ctx.partyName && ctx.partyName.trim().length > 2) {
    pushUniqueSeed(seeds, {
      name: ctx.partyName.trim(),
      organizationName: orgHint,
    });
  }

  for (const alias of ctx.aliases ?? []) {
    if (alias.trim().length > 2 && !/^\d+$/.test(alias.trim())) {
      pushUniqueSeed(seeds, { name: alias.trim(), organizationName: orgHint });
    }
  }

  for (const finding of ctx.priorFindings ?? []) {
    const details = finding.details ?? {};
    collectFromList(seeds, details.qsa, orgHint);
    collectFromList(seeds, details.relatedPeople, orgHint);
    collectFromList(seeds, details.shareholdings, orgHint);
    collectFromList(seeds, details.emails, orgHint);

    const email = asText(details.email);
    if (email && isValidEmail(email)) {
      pushUniqueSeed(seeds, {
        email: email.toLowerCase(),
        name: readPersonName(details) ?? ctx.partyName,
        organizationName: orgHint ?? asText(details.organizationName ?? details.razao_social),
        domain: domainFromEmail(email),
      });
    }

    const website = asText(details.website ?? details.domain ?? details.site);
    const domain = website ? normalizeDomain(website) : undefined;
    if (domain && ctx.partyName) {
      pushUniqueSeed(seeds, {
        name: ctx.partyName,
        organizationName: orgHint,
        domain,
      });
    }
  }

  return seeds.slice(0, max);
}

export function mapApolloPerson(raw: Record<string, unknown>): ApolloPersonMapped | null {
  const id = asText(raw.id);
  if (!id) return null;
  const org = asRecord(raw.organization);
  const name =
    asText(raw.name) || [asText(raw.first_name), asText(raw.last_name)].filter(Boolean).join(' ');
  if (!name) return null;
  return {
    id,
    name,
    firstName: asText(raw.first_name) || undefined,
    lastName: asText(raw.last_name) || undefined,
    title: asText(raw.title) || undefined,
    email: asText(raw.email) || undefined,
    emailStatus: asText(raw.email_status) || undefined,
    // RF11: phones come from Lemit, never Apollo reveal / incidental match numbers
    phone: undefined,
    linkedinUrl: asText(raw.linkedin_url) || undefined,
    city: asText(raw.city) || undefined,
    state: asText(raw.state) || undefined,
    country: asText(raw.country) || undefined,
    organizationName: asText(org.name) || undefined,
    organizationDomain: asText(org.primary_domain) || asText(org.website_url) || undefined,
  };
}

function personFindings(person: ApolloPersonMapped): ProviderFinding[] {
  const findings: ProviderFinding[] = [];
  const location = [person.city, person.state, person.country].filter(Boolean).join(', ');
  const emails = person.email ? [{ email: person.email, ranking: 1, hasCookie: null }] : [];

  findings.push({
    category: 'IDENTITY',
    title: person.name,
    summary: [
      person.title,
      person.organizationName,
      person.email ? `e-mail ${person.email}` : null,
      location || null,
    ]
      .filter(Boolean)
      .join(' · '),
    details: {
      apolloId: person.id,
      name: person.name,
      title: person.title ?? null,
      email: person.email ?? null,
      emailStatus: person.emailStatus ?? null,
      emails,
      organizationName: person.organizationName ?? null,
      organizationDomain: person.organizationDomain ?? null,
      city: person.city ?? null,
      state: person.state ?? null,
      country: person.country ?? null,
      provider: 'osint-apollo-io',
    },
    confidence: person.email ? 88 : 75,
  });

  if (person.linkedinUrl || person.organizationName) {
    findings.push({
      category: 'SOCIAL_PRESENCE',
      title: person.linkedinUrl
        ? `LinkedIn · ${person.name}`
        : `Organização · ${person.organizationName}`,
      summary: [person.title, person.organizationName, person.linkedinUrl]
        .filter(Boolean)
        .join(' · '),
      details: {
        apolloId: person.id,
        name: person.name,
        linkedinUrl: person.linkedinUrl ?? null,
        organizationName: person.organizationName ?? null,
        organizationDomain: person.organizationDomain ?? null,
        provider: 'osint-apollo-io',
      },
      confidence: 80,
      url: person.linkedinUrl,
    });
  }

  return findings;
}

async function apolloPost(
  path: string,
  body: Record<string, unknown>,
  apiKey: string,
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const result = await fetchJson(
    `${APOLLO_BASE}${path}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(body),
    },
    12_000,
  );
  return {
    ok: result.ok,
    status: result.status,
    json: asRecord(result.json),
  };
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      out[current] = await fn(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) || 1 }, () => worker()));
  return out;
}

function maxMatchesFromEnv(): number {
  const raw = Number(getEnv().APOLLO_MAX_MATCHES);
  if (!Number.isFinite(raw) || raw < 1) return DEFAULT_MAX_MATCHES;
  return Math.min(Math.floor(raw), 25);
}

export const apollo: DossierProvider = {
  name: 'Apollo.io',
  category: 'IDENTITY',
  reliability: 'PAID',
  accepts: ['CPF', 'CNPJ', 'NAME', 'EMAIL'],
  phase: 'sync',
  rateMs: 200,
  async run(ctx) {
    const apiKey = getEnv().APOLLO_API_KEY.trim();
    if (!apiKey) return skipped('APOLLO_API_KEY não configurada');

    const max = maxMatchesFromEnv();
    const orgName =
      ctx.targetType === 'CNPJ'
        ? (ctx.partyName ?? undefined)
        : (ctx.priorFindings
            .map((f) => asText(f.details.organizationName ?? f.details.razao_social))
            .find((v) => v.length > 2) ?? undefined);

    const seeds = collectApolloSeeds(ctx, { organizationName: orgName, max });
    if (seeds.length === 0) {
      return skipped('Sem nome/e-mail para enriquecer no Apollo');
    }

    const findings: ProviderFinding[] = [];
    const rawPayloads: unknown[] = [];
    let httpStatus = 200;
    let matched = 0;

    // Optional org enrich once when we have a domain
    const domainSeed = seeds.find((s) => s.domain);
    if (domainSeed?.domain) {
      const orgResult = await apolloPost(
        '/organizations/enrich',
        { domain: domainSeed.domain },
        apiKey,
      );
      rawPayloads.push({ organizationsEnrich: orgResult.json });
      if (orgResult.status === 429) {
        return { status: 'rate_limited', httpStatus: 429, findings: [], rawPayload: rawPayloads };
      }
      const organization = asRecord(orgResult.json.organization);
      if (orgResult.ok && asText(organization.name)) {
        findings.push({
          category: 'SOCIAL_PRESENCE',
          title: `Empresa Apollo · ${asText(organization.name)}`,
          summary: [
            asText(organization.primary_domain) || domainSeed.domain,
            asText(organization.industry),
            asText(organization.estimated_num_employees)
              ? `${asText(organization.estimated_num_employees)} colaboradores`
              : null,
          ]
            .filter(Boolean)
            .join(' · '),
          details: {
            organization,
            domain: domainSeed.domain,
            provider: 'osint-apollo-io',
          },
          confidence: 82,
          url: asText(organization.website_url) || undefined,
        });
      }
    }

    const matchResults = await mapLimit(seeds, 2, async (seed) => {
      const body: Record<string, unknown> = {
        reveal_personal_emails: true,
        reveal_phone_number: false, // RF11: phones from Lemit, never Apollo reveal
      };
      if (seed.name) body.name = seed.name;
      if (seed.email) body.email = seed.email;
      if (seed.organizationName) body.organization_name = seed.organizationName;
      if (seed.domain) body.domain = seed.domain;
      return apolloPost('/people/match', body, apiKey);
    });

    for (let i = 0; i < matchResults.length; i += 1) {
      const result = matchResults[i];
      const seed = seeds[i];
      rawPayloads.push({ peopleMatch: result.json, seed });
      httpStatus = result.status || httpStatus;

      if (result.status === 429) {
        return {
          status: 'rate_limited',
          httpStatus: 429,
          findings,
          rawPayload: rawPayloads,
        };
      }

      if (result.status === 404 || (!result.ok && result.status === 200 && !result.json.person)) {
        findings.push({
          category: 'IDENTITY',
          title: `Consultado — nada consta no Apollo (${seed.name ?? seed.email ?? 'alvo'})`,
          summary: 'Apollo foi consultada e não retornou pessoa para os dados fornecidos.',
          details: {
            consultedAbsent: true,
            status: 'CHECKED_ABSENT',
            seed,
            provider: 'osint-apollo-io',
          },
          confidence: 70,
        });
        continue;
      }

      if (!result.ok) continue;

      const rawPerson = asRecord(
        result.json.person && typeof result.json.person === 'object' ? result.json.person : null,
      );
      if (!asText(rawPerson.id)) {
        findings.push({
          category: 'IDENTITY',
          title: `Consultado — nada consta no Apollo (${seed.name ?? seed.email ?? 'alvo'})`,
          summary: 'Apollo foi consultada e não retornou pessoa para os dados fornecidos.',
          details: {
            consultedAbsent: true,
            status: 'CHECKED_ABSENT',
            seed,
            provider: 'osint-apollo-io',
          },
          confidence: 70,
        });
        continue;
      }

      const person = mapApolloPerson(rawPerson);
      if (!person) continue;
      matched += 1;
      findings.push(...personFindings(person));
    }

    if (findings.length === 0 && matched === 0) {
      return skipped('Apollo sem correspondências úteis');
    }

    return ok(findings, rawPayloads, httpStatus);
  },
};
