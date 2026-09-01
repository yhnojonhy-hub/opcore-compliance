import type { DocumentType, Prisma, Provider } from '@prisma/client';
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
  payload: Record<string, unknown>;
  rawPayload: unknown;
  cachedAt: string;
  providerId: string;
  cacheHit: boolean;
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
}): Promise<ConsultResult> {
  const provider = await resolveProvider(params.documentType, params.providerSlug);

  const existing = await prisma.complianceConsultation.findUnique({
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

    return {
      document: params.document,
      documentType: params.documentType,
      provider: provider.slug,
      source: 'cache',
      payload,
      rawPayload: existing.rawPayload,
      cachedAt: existing.updatedAt.toISOString(),
      providerId: provider.id,
      cacheHit: true,
    };
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
    action: 'cache_miss',
    document: params.document,
    providerId: provider.id,
    metadata: { mappedFields: Object.keys(payload).length },
  });

  return {
    document: params.document,
    documentType: params.documentType,
    provider: provider.slug,
    source: 'provider',
    payload,
    rawPayload,
    cachedAt: new Date().toISOString(),
    providerId: provider.id,
    cacheHit: false,
  };
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

export async function getProviderRecord(provider: Provider) {
  return provider;
}
