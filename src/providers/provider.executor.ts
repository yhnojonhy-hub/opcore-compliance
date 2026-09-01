import type { DocumentType, Provider } from '@prisma/client';
import { env } from '../lib/env.js';
import type { ConsultContext } from './provider.interface.js';
import { interpolateTemplate, loadFixture } from './provider.mapper.js';

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
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((requestTemplate.headers as Record<string, string>) ?? {}),
  };

  applyAuth(provider, headers);

  const init: RequestInit = { method: provider.httpMethod, headers };

  if (provider.httpMethod !== 'GET' && requestTemplate.body) {
    init.body = JSON.stringify(requestTemplate.body);
  }

  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`Provider ${provider.slug} returned ${response.status}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return response.json();
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

function applyAuth(provider: Provider, headers: Record<string, string>) {
  if (provider.authType === 'bearer' && provider.authConfigRef) {
    const token = process.env[provider.authConfigRef];
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  if (provider.authType === 'api_key_header' && provider.authConfigRef) {
    const token = process.env[provider.authConfigRef];
    const headerName = headers['X-Api-Key-Header'] ?? 'X-API-Key';
    if (token) headers[headerName] = token;
  }
}

export function resolveDocumentTypeFilter(documentType: DocumentType): string {
  return documentType;
}

export function cacheExpiresAt(): Date {
  const d = new Date();
  d.setDate(d.getDate() + env.cacheTtlDays);
  return d;
}
