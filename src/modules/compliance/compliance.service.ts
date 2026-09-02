import type { DocumentType, Prisma } from '@prisma/client';
import { flatMappedToSections } from '../../contracts/utils/mapped-payload.util.js';
import { pruneEmptyDeep } from '../../contracts/utils/prune.util.js';
import { prisma } from '../../db/prisma.js';
import { applyFieldMappings, resolveMappedPayload } from '../../providers/provider.mapper.js';
import { cacheExpiresAt, executeProvider } from '../../providers/provider.executor.js';
import { resolveProvider } from '../../providers/provider.registry.js';
import type { FieldMapping } from '../../providers/provider.interface.js';

export interface ConsultResult {
  document: string;
  documentType: DocumentType;
  provider: string;
  source: 'cache' | 'provider';
  payload: { sections: Record<string, Record<string, unknown>> };
  rawPayload?: unknown;
  cachedAt: string;
  providerId: string;
  cacheHit: boolean;
}

export function formatConsultResult(
  result: Omit<ConsultResult, 'payload' | 'rawPayload'> & {
    mapped: Record<string, unknown>;
    rawPayload: unknown;
  },
  options?: { includeRaw?: boolean },
): ConsultResult {
  const sections = flatMappedToSections(result.mapped);
  const payload = pruneEmptyDeep({ sections }) as ConsultResult['payload'];
  const formatted: ConsultResult = {
    document: result.document,
    documentType: result.documentType,
    provider: result.provider,
    source: result.source,
    payload,
    cachedAt: result.cachedAt,
    providerId: result.providerId,
    cacheHit: result.cacheHit,
  };
  if (options?.includeRaw) {
    formatted.rawPayload = result.rawPayload;
  }
  return formatted;
}

export async function logAudit(params: {
  action: string;
  document: string;
  providerId?: string;
  metadata?: Record<string, unknown>;
}) {
  await prisma.auditLog.create({
    data: {
      action: params.action,
      document: params.document,
      providerId: params.providerId,
      metadata: (params.metadata as Prisma.InputJsonValue) ?? undefined,
    },
  });
}

function isCacheValid(expiresAt: Date | null): boolean {
  if (!expiresAt) return true;
  return expiresAt > new Date();
}

export async function consultDocument(params: {
  document: string;
  documentType: DocumentType;
  providerSlug?: string;
  requestedBy?: string;
  includeRaw?: boolean;
  forceRefresh?: boolean;
}): Promise<ConsultResult> {
  const provider = await resolveProvider(params.documentType, params.providerSlug);

  const existing = params.forceRefresh
    ? null
    : await prisma.complianceConsultation.findUnique({
        where: {
          document_documentType_providerId: {
            document: params.document,
            documentType: params.documentType,
            providerId: provider.id,
          },
        },
      });

  if (existing && isCacheValid(existing.expiresAt)) {
    const fieldMappings = provider.fieldMappings as unknown as FieldMapping[];
    const payload = resolveMappedPayload(
      existing.rawPayload,
      fieldMappings,
      existing.payload as Record<string, unknown>,
    );

    const storedPayload = existing.payload as Record<string, unknown>;
    if (JSON.stringify(payload) !== JSON.stringify(storedPayload)) {
      await prisma.complianceConsultation.update({
        where: {
          document_documentType_providerId: {
            document: params.document,
            documentType: params.documentType,
            providerId: provider.id,
          },
        },
        data: { payload: payload as Prisma.InputJsonValue },
      });
    }

    await logAudit({
      action: 'cache_hit',
      document: params.document,
      providerId: provider.id,
    });

    return formatConsultResult(
      {
        document: params.document,
        documentType: params.documentType,
        provider: provider.slug,
        source: 'cache',
        mapped: payload,
        rawPayload: existing.rawPayload,
        cachedAt: existing.updatedAt.toISOString(),
        providerId: provider.id,
        cacheHit: true,
      },
      { includeRaw: params.includeRaw },
    );
  }

  const rawPayload = await executeProvider(provider, {
    document: params.document,
    documentType: params.documentType,
  });

  const fieldMappings = provider.fieldMappings as unknown as FieldMapping[];
  const payload = applyFieldMappings(rawPayload, fieldMappings);
  const expiresAt = cacheExpiresAt();

  await prisma.complianceConsultation.upsert({
    where: {
      document_documentType_providerId: {
        document: params.document,
        documentType: params.documentType,
        providerId: provider.id,
      },
    },
    create: {
      document: params.document,
      documentType: params.documentType,
      providerId: provider.id,
      payload: payload as Prisma.InputJsonValue,
      rawPayload: rawPayload as Prisma.InputJsonValue,
      requestedBy: params.requestedBy,
      expiresAt,
    },
    update: {
      payload: payload as Prisma.InputJsonValue,
      rawPayload: rawPayload as Prisma.InputJsonValue,
      requestedBy: params.requestedBy,
      expiresAt,
    },
  });

  await logAudit({
    action: params.forceRefresh ? 'cache_bypass' : 'cache_miss',
    document: params.document,
    providerId: provider.id,
    metadata: { mappedFields: Object.keys(payload).length },
  });

  return formatConsultResult(
    {
      document: params.document,
      documentType: params.documentType,
      provider: provider.slug,
      source: 'provider',
      mapped: payload,
      rawPayload,
      cachedAt: new Date().toISOString(),
      providerId: provider.id,
      cacheHit: false,
    },
    { includeRaw: params.includeRaw },
  );
}

export async function getCachedConsultations(document: string, documentType?: DocumentType) {
  return prisma.complianceConsultation.findMany({
    where: {
      document,
      ...(documentType ? { documentType } : {}),
    },
    include: { provider: true },
    orderBy: { updatedAt: 'desc' },
  });
}

export function toConsultationInput(
  row: Awaited<ReturnType<typeof getCachedConsultations>>[number],
  cacheHit: boolean,
) {
  const fieldMappings = row.provider.fieldMappings as unknown as FieldMapping[];
  const payload = resolveMappedPayload(
    row.rawPayload,
    fieldMappings,
    row.payload as Record<string, unknown>,
  );

  return {
    providerSlug: row.provider.slug,
    consultedAt: row.updatedAt,
    cacheHit,
    priority: row.provider.priority,
    payload,
    rawPayload: row.rawPayload,
    fieldMappings,
  };
}
