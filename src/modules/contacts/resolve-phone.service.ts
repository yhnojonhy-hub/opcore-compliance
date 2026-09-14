import type { Phone } from '../../contracts/types/canonical/shared.types.js';
import { asList } from '../../contracts/utils/array.util.js';
import { normalizePhoneList } from '../../dossier/normalizers/contacts.normalizer.js';
import { asRecord, fetchJson } from '../../providers/adapters/http.util.js';
import { ProviderHttpError } from '../../providers/provider.errors.js';
import { consultDocument, type ConsultResult } from '../compliance/compliance.service.js';

const BDC_BASE = 'https://plataforma.bigdatacorp.com.br';

export type ResolvePhoneSource = 'lemit' | 'bdc' | null;

export interface ResolvePhoneResult {
  document: string | null;
  phones: Phone[];
  source: ResolvePhoneSource;
}

export interface ResolvePhoneInput {
  name: string;
  email?: string | null;
}

type ConsultFn = typeof consultDocument;
type BdcIdentityFn = (name: string, email: string) => Promise<string | null>;

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** Escape braces/commas that break BDC `q` clauses. */
export function sanitizeBdcQueryValue(value: string): string {
  return value.trim().replace(/[{},]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function buildBdcNameEmailQuery(name: string, email: string): string {
  return `name{${sanitizeBdcQueryValue(name)}}, email{${sanitizeBdcQueryValue(email)}}`;
}

function emailsFromBdcResult(row: Record<string, unknown>): string[] {
  const out: string[] = [];
  const emails = asRecord(row.Emails);
  const primary = asRecord(emails.Primary);
  const primaryAddr = primary.EmailAddress ?? primary.email;
  if (typeof primaryAddr === 'string' && primaryAddr.trim()) {
    out.push(normalizeEmail(primaryAddr));
  }
  for (const item of asList(emails.Secondary ?? emails.Emails ?? emails.OtherEmails)) {
    const rec = asRecord(item);
    const addr = rec.EmailAddress ?? rec.email;
    if (typeof addr === 'string' && addr.trim()) out.push(normalizeEmail(addr));
  }
  // Some payloads nest emails as a flat array on the Result row
  for (const item of asList(row.emails)) {
    const rec = asRecord(item);
    const addr = rec.EmailAddress ?? rec.email;
    if (typeof addr === 'string' && addr.trim()) out.push(normalizeEmail(addr));
  }
  return out;
}

/**
 * Pick a single TaxIdNumber from BDC Results.
 * Prefer the row whose email list matches the query email.
 * If multiple rows and none/ambiguous email match → null (no guessing).
 */
export function pickCpfFromBdcResults(payload: unknown, queryEmail: string): string | null {
  const root = asRecord(payload);
  const rows = asList(root.Result)
    .map(asRecord)
    .filter((r) => Object.keys(r).length > 0);
  if (rows.length === 0) return null;

  const want = normalizeEmail(queryEmail);
  const withCpf = rows
    .map((row) => {
      const basic = asRecord(row.BasicData);
      const raw =
        (typeof basic.TaxIdNumber === 'string' && basic.TaxIdNumber) ||
        (typeof row.TaxIdNumber === 'string' && row.TaxIdNumber) ||
        '';
      const cpf = digitsOnly(raw);
      return { cpf, emails: emailsFromBdcResult(row), row };
    })
    .filter((item) => item.cpf.length === 11);

  if (withCpf.length === 0) return null;

  const emailMatches = withCpf.filter((item) => item.emails.includes(want));
  if (emailMatches.length === 1) return emailMatches[0].cpf;
  if (emailMatches.length > 1) {
    const unique = new Set(emailMatches.map((item) => item.cpf));
    if (unique.size === 1) return emailMatches[0].cpf;
    return null;
  }

  // Query already constrained by email{} — accept single unambiguous CPF
  if (withCpf.length === 1) return withCpf[0].cpf;
  return null;
}

export function phonesFromConsult(result: ConsultResult): Phone[] {
  const cadastral = asRecord(result.payload?.sections?.cadastral);
  const phones = normalizePhoneList(cadastral.phones, null);
  const mobiles = normalizePhoneList(cadastral.mobilePhones, 'mobile');
  const landlines = normalizePhoneList(cadastral.landlinePhones, 'landline');
  return [...phones, ...mobiles, ...landlines].filter((p) => p.number != null || p.ddd != null);
}

export async function lookupCpfViaBdcNameEmail(
  name: string,
  email: string,
): Promise<string | null> {
  const accessToken = process.env.BIGDATACORP_ACCESS_TOKEN?.trim();
  const tokenId = process.env.BIGDATACORP_TOKEN_ID?.trim();
  if (!accessToken || !tokenId) {
    throw new Error('Secrets BIGDATACORP_ACCESS_TOKEN / BIGDATACORP_TOKEN_ID não configurados');
  }

  const q = buildBdcNameEmailQuery(name, email);
  const result = await fetchJson(
    `${BDC_BASE}/pessoas`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        AccessToken: accessToken,
        TokenId: tokenId,
      },
      body: JSON.stringify({
        Datasets: 'basic_data',
        q,
        Limit: 5,
      }),
    },
    12_000,
  );

  if (!result.ok) {
    if (result.status === 404) return null;
    throw new ProviderHttpError(
      `BDC identity retornou HTTP ${result.status}`,
      'bigdatacorp-pf-basic_data',
      result.status,
      result.text,
    );
  }

  return pickCpfFromBdcResults(result.json, email);
}

async function phonesFromLemit(cpf: string, consult: ConsultFn): Promise<Phone[]> {
  try {
    const result = await consult({
      document: cpf,
      documentType: 'CPF',
      providerSlug: 'lemit-cpf',
    });
    return phonesFromConsult(result);
  } catch (err) {
    if (
      err instanceof ProviderHttpError &&
      (err.upstreamStatus === 404 || err.upstreamStatus === 422)
    ) {
      return [];
    }
    throw err;
  }
}

async function phonesFromBdcExtended(cpf: string, consult: ConsultFn): Promise<Phone[]> {
  try {
    const result = await consult({
      document: cpf,
      documentType: 'CPF',
      providerSlug: 'bigdatacorp-pf-phones_extended',
    });
    return phonesFromConsult(result);
  } catch (err) {
    if (
      err instanceof ProviderHttpError &&
      (err.upstreamStatus === 404 || err.upstreamStatus === 422)
    ) {
      return [];
    }
    throw err;
  }
}

/**
 * RF12 — commercial phone resolution for CRM.
 * BDC name+email → CPF → Lemit → BDC phones_extended.
 * Does **not** call Apollo.
 */
export async function resolvePhone(
  input: ResolvePhoneInput,
  deps?: { consult?: ConsultFn; lookupCpf?: BdcIdentityFn },
): Promise<ResolvePhoneResult> {
  const name = input.name?.trim() ?? '';
  const email = input.email?.trim() ?? '';
  if (!name) {
    return { document: null, phones: [], source: null };
  }
  // Homonym risk: never resolve by name alone
  if (!email || !email.includes('@')) {
    return { document: null, phones: [], source: null };
  }

  const consult = deps?.consult ?? consultDocument;
  const lookupCpf = deps?.lookupCpf ?? lookupCpfViaBdcNameEmail;

  const cpf = await lookupCpf(name, email);
  if (!cpf) {
    return { document: null, phones: [], source: null };
  }

  const lemitPhones = await phonesFromLemit(cpf, consult);
  if (lemitPhones.length > 0) {
    return { document: cpf, phones: lemitPhones, source: 'lemit' };
  }

  const bdcPhones = await phonesFromBdcExtended(cpf, consult);
  if (bdcPhones.length > 0) {
    return { document: cpf, phones: bdcPhones, source: 'bdc' };
  }

  return { document: cpf, phones: [], source: null };
}

/** Best E.164-ish display string for CRM `leads.phone`. */
export function primaryPhoneNumber(phones: Phone[]): string | null {
  if (phones.length === 0) return null;
  const sorted = [...phones].sort((a, b) => (a.ranking ?? 99) - (b.ranking ?? 99));
  const best = sorted[0];
  const digits = digitsOnly(`${best.ddd ?? ''}${best.number ?? ''}`);
  if (digits.length < 10) return null;
  if (digits.startsWith('55')) return `+${digits}`;
  return `+55${digits}`;
}
