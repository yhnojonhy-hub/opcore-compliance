import type { DocumentType, Provider } from '@prisma/client';
import { env } from '../lib/env.js';
import type { ConsultContext } from './provider.interface.js';
import { interpolateTemplate, loadFixture } from './provider.mapper.js';
import { ProviderHttpError } from './provider.errors.js';

export async function executeProvider(provider: Provider, ctx: ConsultContext): Promise<unknown> {
  const templateCtx = {
    document: ctx.document,
    documentType: ctx.documentType,
  };

  if (provider.authType === 'mock') {
    const requestTemplate = provider.requestTemplate as { fixtureKey?: string };
    const fixtureKey =
      requestTemplate.fixtureKey ?? (ctx.documentType === 'CPF' ? 'cpf_default' : 'cnpj_default');
    const fixture = loadFixture(fixtureKey);
    return interpolateTemplate(fixture, templateCtx);
  }

  const requestTemplate = interpolateTemplate(
    provider.requestTemplate as Record<string, unknown>,
    templateCtx,
  );
  const url = buildUrl(provider.baseUrl, requestTemplate);
  const rawHeaders = (requestTemplate.headers as Record<string, string>) ?? {};
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(provider.authType === 'env_headers' ? resolveEnvHeaders(rawHeaders) : rawHeaders),
  };

  applyAuth(provider, headers);

  const init: RequestInit = { method: provider.httpMethod, headers };

  if (provider.httpMethod !== 'GET' && requestTemplate.body) {
    init.body = JSON.stringify(requestTemplate.body);
  }

  const response = await fetch(url, init);
  if (!response.ok) {
    const upstreamBody = await response.text();
    const detail = formatUpstreamBody(upstreamBody);
    throw new ProviderHttpError(
      `Provedor ${provider.slug} retornou HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
      provider.slug,
      response.status,
      upstreamBody,
    );
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const json = await response.json();
    assertNoUpstreamStatusErrors(json, provider.slug);
    return json;
  }
  return { raw: await response.text() };
}

function buildUrl(baseUrl: string, template: Record<string, unknown>): string {
  const path = String(template.path ?? '/');
  const base = baseUrl.replace(/\/$/, '');
  const url = new URL(`${base}${path.startsWith('/') ? path : `/${path}`}`);
  const query = template.query as Record<string, string> | undefined;
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, v);
    }
  }
  return url.toString();
}

function resolveEnvHeaders(headers: Record<string, string>): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value.startsWith('env:')) {
      const envVar = value.slice(4);
      const secret = process.env[envVar];
      if (!secret) {
        throw new Error(`Secret ${envVar} não configurado — reinicie a API após definir no .env`);
      }
      resolved[name] = secret;
    } else {
      resolved[name] = value;
    }
  }
  return resolved;
}

function applyAuth(provider: Provider, headers: Record<string, string>) {
  if (provider.authType === 'bearer' && provider.authConfigRef) {
    const token = process.env[provider.authConfigRef];
    if (!token) {
      throw new Error(
        `Secret ${provider.authConfigRef} não configurado — reinicie a API após definir no .env`,
      );
    }
    headers.Authorization = `Bearer ${token}`;
  }
  if (provider.authType === 'api_key_header' && provider.authConfigRef) {
    const token = process.env[provider.authConfigRef];
    if (!token) {
      throw new Error(
        `Secret ${provider.authConfigRef} não configurado — reinicie a API após definir no .env`,
      );
    }
    const headerName = headers['X-Api-Key-Header'] ?? 'X-API-Key';
    headers[headerName] = token;
  }
}

function assertNoUpstreamStatusErrors(payload: unknown, slug: string): void {
  if (!payload || typeof payload !== 'object') return;
  const status = (payload as { Status?: Record<string, unknown> }).Status;
  if (!status || typeof status !== 'object') return;

  const messages: string[] = [];
  for (const entries of Object.values(status)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      const code = (entry as { Code?: unknown }).Code;
      const msg = (entry as { Message?: unknown }).Message;
      const isError =
        typeof code === 'number'
          ? code !== 0
          : typeof msg === 'string' && msg.toUpperCase() !== 'OK';
      if (isError && typeof msg === 'string' && msg.trim()) {
        messages.push(msg.trim());
      }
    }
  }

  if (messages.length > 0) {
    throw new ProviderHttpError(
      `Provedor ${slug}: ${messages.join('; ')}`,
      slug,
      502,
      JSON.stringify(payload),
    );
  }
}

function formatUpstreamBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return '';
  try {
    const parsed = JSON.parse(trimmed) as { errors?: unknown; error?: unknown; message?: string };
    if (Array.isArray(parsed.errors)) return parsed.errors.join(', ');
    if (typeof parsed.error === 'string') return parsed.error;
    if (typeof parsed.message === 'string') return parsed.message;
  } catch {
    // not JSON
  }
  return trimmed.length > 160 ? `${trimmed.slice(0, 160)}…` : trimmed;
}

export function resolveDocumentTypeFilter(documentType: DocumentType): string {
  return documentType;
}

export function cacheExpiresAt(): Date {
  const d = new Date();
  d.setDate(d.getDate() + env.cacheTtlDays);
  return d;
}
