import type { DocumentType, Provider } from '@prisma/client';
import { env } from '../lib/env.js';
import type { RequestTemplate } from './provider.interface.js';

export function getProviderActivationTier(provider: Provider): number {
  const template = provider.requestTemplate as RequestTemplate;
  return template._bdcMeta?.activationTier ?? 3;
}

export function getBdcMaxTier(override?: number): number {
  if (override != null && !Number.isNaN(override)) return override;
  return env.bdcMaxTier;
}

export function providerMatchesTier(provider: Provider, maxTier: number): boolean {
  return getProviderActivationTier(provider) <= maxTier;
}

export async function filterProvidersByTier(
  providers: Provider[],
  maxTier: number,
): Promise<Provider[]> {
  return providers.filter((p) => providerMatchesTier(p, maxTier));
}

export type { DocumentType };
