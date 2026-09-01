import { createHash } from 'node:crypto';
import { isValidEmail } from '../../../contracts/utils/document.util.js';
import { asRecord, fetchJson } from '../http.util.js';
import type { DossierProvider, ProviderContext, ProviderFinding } from '../types.js';

function skipped(reason: string) {
  return { status: 'skipped' as const, error: reason, findings: [] };
}

function ok(findings: ProviderFinding[], rawPayload?: unknown, httpStatus = 200) {
  return { status: 'ok' as const, httpStatus, rawPayload, findings };
}

function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function namesOf(ctx: ProviderContext): string[] {
  const values = [
    ctx.partyName,
    ctx.targetType === 'NAME' ? ctx.target : '',
    ...(ctx.aliases ?? []),
  ]
    .map((item) => item?.trim() ?? '')
    .filter((item) => item.length > 3 && /[A-Za-zÀ-ÿ]/.test(item));
  return [...new Set(values)].slice(0, 4);
}

function emailOf(ctx: ProviderContext): string | null {
  if (ctx.targetType === 'EMAIL' && isValidEmail(ctx.target))
    return ctx.target.trim().toLowerCase();
  return null;
}

function usernameCandidates(ctx: ProviderContext): string[] {
  const out = new Set<string>();
  const email = emailOf(ctx);
  if (email) {
    const local = email.split('@')[0].replace(/[^a-z0-9._-]/g, '');
    if (local.length >= 3) {
      out.add(local);
      out.add(local.replace(/[._-]/g, ''));
    }
  }
  for (const name of namesOf(ctx)) {
    const parts = stripAccents(name)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((part) => part.length > 1);
    if (parts.length < 2) continue;
    out.add(`${parts[0]}${parts[parts.length - 1]}`);
    out.add(`${parts[0]}.${parts[parts.length - 1]}`);
    out.add(parts.join(''));
  }
  return [...out].filter((item) => item.length >= 3 && item.length <= 32).slice(0, 3);
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

function finding(
  title: string,
  summary: string,
  details: Record<string, unknown>,
  url?: string,
  confidence = 58,
): ProviderFinding {
  return { category: 'SOCIAL_PRESENCE', title, summary, details, confidence, url };
}

async function probeGithubUser(username: string): Promise<ProviderFinding | null> {
  const result = await fetchJson(
    `https://api.github.com/users/${encodeURIComponent(username)}`,
    {},
    6_000,
  );
  if (result.status === 404 || !result.ok) return null;
  const data = asRecord(result.json);
  const login = String(data.login ?? '');
  if (!login) return null;
  const name = String(data.name ?? login);
  const extra = [data.bio, data.company, data.location].filter(Boolean).join(' · ');
  return finding(
    `GitHub @${login}`,
    extra ? `${name} — ${extra}` : `Perfil público @${login}`,
    {
      platform: 'github',
      login,
      name: data.name ?? null,
      company: data.company ?? null,
      location: data.location ?? null,
      followers: data.followers ?? null,
    },
    String(data.html_url ?? `https://github.com/${login}`),
    62,
  );
}

async function searchGithubByName(name: string): Promise<ProviderFinding[]> {
  const query = `${name} in:fullname`;
  const result = await fetchJson(
    `https://api.github.com/search/users?q=${encodeURIComponent(query)}&per_page=5`,
    { headers: { Accept: 'application/vnd.github+json' } },
    7_000,
  );
  if (!result.ok) return [];
  const items = Array.isArray(asRecord(result.json).items)
    ? (asRecord(result.json).items as unknown[])
    : [];
  return items.slice(0, 5).flatMap((item) => {
    const data = asRecord(item);
    const login = String(data.login ?? '');
    if (!login) return [];
    return [
      finding(
        `GitHub @${login}`,
        `Possível perfil para "${name}"`,
        { platform: 'github', login, match: 'fullname', name },
        String(data.html_url ?? `https://github.com/${login}`),
        48,
      ),
    ];
  });
}

async function probeGitlab(username: string): Promise<ProviderFinding | null> {
  const result = await fetchJson(
    `https://gitlab.com/api/v4/users?username=${encodeURIComponent(username)}`,
    {},
    6_000,
  );
  if (!result.ok || !Array.isArray(result.json) || result.json.length === 0) return null;
  const data = asRecord(result.json[0]);
  const handle = String(data.username ?? username);
  return finding(
    `GitLab @${handle}`,
    String(data.name ?? `Perfil público @${handle}`),
    { platform: 'gitlab', username: handle, name: data.name ?? null },
    String(data.web_url ?? `https://gitlab.com/${handle}`),
    60,
  );
}

async function probeKeybase(username: string): Promise<ProviderFinding | null> {
  const result = await fetchJson(
    `https://keybase.io/_/api/1.0/user/lookup.json?username=${encodeURIComponent(username)}`,
    {},
    6_000,
  );
  if (!result.ok) return null;
  const payload = asRecord(result.json);
  if (String(asRecord(payload.status).name ?? '') !== 'OK') return null;
  const them = Array.isArray(payload.them) ? payload.them : [];
  const person = asRecord(them[0]);
  const basics = asRecord(person.basics);
  const handle = String(basics.username ?? username);
  if (!handle) return null;
  return finding(
    `Keybase @${handle}`,
    String(asRecord(person.profile).bio ?? `Identidade pública @${handle}`),
    { platform: 'keybase', username: handle },
    `https://keybase.io/${handle}`,
    64,
  );
}

async function probeGravatar(email: string): Promise<ProviderFinding | null> {
  const hash = createHash('md5').update(email).digest('hex');
  const result = await fetchJson(`https://www.gravatar.com/${hash}.json`, {}, 6_000);
  if (result.status === 404 || !result.ok) return null;
  const entries = asRecord(result.json).entry;
  const entry = asRecord(Array.isArray(entries) ? entries[0] : null);
  if (!entry.hash && !entry.displayName) return null;
  const accounts = Array.isArray(entry.accounts) ? entry.accounts : [];
  const links = accounts
    .map((item) => {
      const account = asRecord(item);
      return String(account.url ?? account.domain ?? '');
    })
    .filter(Boolean)
    .slice(0, 6);
  return finding(
    `Gravatar ${String(entry.displayName ?? email)}`,
    links.length ? `Contas ligadas: ${links.join(', ')}` : 'Avatar público associado ao e-mail',
    { platform: 'gravatar', displayName: entry.displayName ?? null, accounts: links },
    `https://www.gravatar.com/${hash}`,
    70,
  );
}

export const osintUsername: DossierProvider = {
  name: 'OSINT username',
  category: 'SOCIAL_PRESENCE',
  reliability: 'SCRAPING',
  accepts: ['NAME', 'EMAIL', 'CPF', 'CNPJ'],
  phase: 'async',
  rateMs: 400,
  async run(ctx) {
    const email = emailOf(ctx);
    const names = namesOf(ctx);
    const usernames = usernameCandidates(ctx);
    if (!email && names.length === 0 && usernames.length === 0) {
      return skipped('OSINT precisa de nome ou e-mail');
    }

    const tasks: Array<() => Promise<ProviderFinding | ProviderFinding[] | null>> = [];
    if (email) tasks.push(() => probeGravatar(email));
    for (const name of names.slice(0, 2)) {
      tasks.push(() => searchGithubByName(name));
    }
    for (const username of usernames) {
      tasks.push(() => probeGithubUser(username));
      tasks.push(() => probeGitlab(username));
      tasks.push(() => probeKeybase(username));
    }

    const results = await mapLimit(tasks, 4, (task) => task());
    const findings = results
      .flat()
      .filter((item): item is ProviderFinding => Boolean(item))
      .filter(
        (item, index, all) =>
          all.findIndex((other) => other.url === item.url && other.title === item.title) === index,
      )
      .slice(0, 12);

    if (findings.length === 0) {
      return ok(
        [
          finding(
            'Nenhum perfil público inicial',
            'GitHub, GitLab, Gravatar e Keybase não devolveram correspondência para o nome ou e-mail',
            { usernames, names, email: Boolean(email) },
            undefined,
            40,
          ),
        ],
        { usernames, hits: 0 },
      );
    }
    return ok(findings, { usernames, hits: findings.length });
  },
};
