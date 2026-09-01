import type { DocumentType, Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { env } from '../lib/env.js';
import type { ProviderConfig } from './provider.interface.js';

export async function listActiveProviders() {
  return prisma.provider.findMany({
    where: { isActive: true },
    orderBy: { priority: 'asc' },
  });
}

export async function getProviderBySlug(slug: string) {
  return prisma.provider.findUnique({ where: { slug } });
}

export async function resolveProvider(documentType: DocumentType, slug?: string) {
  if (slug) {
    const provider = await getProviderBySlug(slug);
    if (!provider || !provider.isActive) {
      throw new Error(`Provedor não encontrado ou inativo: ${slug}`);
    }
    if (!provider.supportedTypes.includes(documentType)) {
      throw new Error(`Provedor ${slug} não suporta ${documentType}`);
    }
    return provider;
  }

  if (env.defaultProviderSlug) {
    const provider = await getProviderBySlug(env.defaultProviderSlug);
    if (provider?.isActive && provider.supportedTypes.includes(documentType)) {
      return provider;
    }
  }

  const provider = await prisma.provider.findFirst({
    where: { isActive: true, supportedTypes: { has: documentType } },
    orderBy: { priority: 'asc' },
  });

  if (!provider) {
    throw new Error(`Nenhum provedor ativo para ${documentType}`);
  }
  return provider;
}

export async function createProvider(data: ProviderConfig) {
  return prisma.provider.create({
    data: {
      slug: data.slug,
      name: data.name,
      baseUrl: data.baseUrl,
      httpMethod: data.httpMethod,
      requestTemplate: data.requestTemplate as unknown as Prisma.InputJsonValue,
      authType: data.authType,
      authConfigRef: data.authConfigRef,
      fieldMappings: data.fieldMappings as unknown as Prisma.InputJsonValue,
      supportedTypes: data.supportedTypes,
      isActive: data.isActive,
      priority: data.priority,
    },
  });
}

export async function updateProvider(slug: string, data: Partial<ProviderConfig>) {
  return prisma.provider.update({
    where: { slug },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.baseUrl !== undefined && { baseUrl: data.baseUrl }),
      ...(data.httpMethod !== undefined && { httpMethod: data.httpMethod }),
      ...(data.requestTemplate !== undefined && {
        requestTemplate: data.requestTemplate as unknown as Prisma.InputJsonValue,
      }),
      ...(data.authType !== undefined && { authType: data.authType }),
      ...(data.authConfigRef !== undefined && { authConfigRef: data.authConfigRef }),
      ...(data.fieldMappings !== undefined && {
        fieldMappings: data.fieldMappings as unknown as Prisma.InputJsonValue,
      }),
      ...(data.supportedTypes !== undefined && { supportedTypes: data.supportedTypes }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
      ...(data.priority !== undefined && { priority: data.priority }),
    },
  });
}
