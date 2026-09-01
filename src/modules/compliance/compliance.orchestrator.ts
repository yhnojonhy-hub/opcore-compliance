import type { DocumentType, Provider } from '@prisma/client';
import { env } from '../../lib/env.js';
import { prisma } from '../../db/prisma.js';
import { ProviderHttpError } from '../../providers/provider.errors.js';
import { filterProvidersByTier, getBdcMaxTier } from '../../providers/provider.tiers.js';
import { consultDocument, logAudit, type ConsultResult } from './compliance.service.js';

export interface ConsultFailure {
  providerSlug: string;
  message: string;
  statusCode?: number;
}

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];

  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await fn(items[index]);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function listActiveProvidersForDocument(
  documentType: DocumentType,
  maxTier?: number,
): Promise<Provider[]> {
  const tier = getBdcMaxTier(maxTier);
  const providers = await prisma.provider.findMany({
    where: { isActive: true, supportedTypes: { has: documentType } },
    orderBy: { priority: 'asc' },
  });

  return filterProvidersByTier(providers, tier);
}

function isProviderHttpError(error: unknown): error is ProviderHttpError {
  return error instanceof ProviderHttpError;
}

export async function consultAllForDocument(params: {
  document: string;
  documentType: DocumentType;
  providerSlug?: string;
  requestedBy?: string;
  maxTier?: number;
  concurrency?: number;
  failFast?: boolean;
}): Promise<ConsultResult[]> {
  if (params.providerSlug) {
    return [
      await consultDocument({
        document: params.document,
        documentType: params.documentType,
        providerSlug: params.providerSlug,
        requestedBy: params.requestedBy,
      }),
    ];
  }

  const providers = await listActiveProvidersForDocument(params.documentType, params.maxTier);
  const concurrency = params.concurrency ?? env.bdcConsultConcurrency;
  const failFast = params.failFast ?? false;
  const failures: ConsultFailure[] = [];

  const results = await mapConcurrent(providers, concurrency, async (provider) => {
    try {
      return await consultDocument({
        document: params.document,
        documentType: params.documentType,
        providerSlug: provider.slug,
        requestedBy: params.requestedBy,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({
        providerSlug: provider.slug,
        message,
        statusCode: isProviderHttpError(error) ? error.upstreamStatus : undefined,
      });

      await logAudit({
        action: 'provider_consult_failed',
        document: params.document,
        providerId: provider.id,
        metadata: {
          message,
          statusCode: isProviderHttpError(error) ? error.upstreamStatus : undefined,
        },
      });

      if (failFast) throw error;
      return null;
    }
  });

  const successful = results.filter((r): r is ConsultResult => r !== null);

  if (successful.length === 0) {
    const summary =
      failures.length > 0
        ? failures.map((f) => `${f.providerSlug}: ${f.message}`).join('; ')
        : `Nenhum provedor ativo para ${params.documentType}`;
    throw new ProviderHttpError(summary, failures[0]?.providerSlug ?? 'orchestrator', 502);
  }

  if (failures.length > 0) {
    await logAudit({
      action: 'orchestrator_partial_failure',
      document: params.document,
      metadata: {
        succeeded: successful.length,
        failed: failures.length,
        failures: failures.map((f) => ({ slug: f.providerSlug, message: f.message })),
      },
    });
  }

  return successful;
}
