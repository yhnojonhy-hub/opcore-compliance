import type { DocumentType, Provider } from '@prisma/client';
import { env } from '../lib/env.js';
import type { RequestTemplate } from './provider.interface.js';

type ProviderTemplate = RequestTemplate & {
  _providerMeta?: { adapterRef?: string };
};

function templateOf(provider: Provider): ProviderTemplate {
  return provider.requestTemplate as ProviderTemplate;
}

export function isOsintAdapterProvider(provider: Provider): boolean {
  return Boolean(templateOf(provider)._providerMeta?.adapterRef);
}

export function isBigDataCorpProvider(provider: Provider): boolean {
  return provider.slug.toLowerCase().startsWith('bigdatacorp');
}

export function hasBdcMeta(provider: Provider): boolean {
  return templateOf(provider)._bdcMeta != null;
}

export function getProviderActivationTier(provider: Provider): number | null {
  const tier = templateOf(provider)._bdcMeta?.activationTier;
  if (tier == null) return null;
  return tier;
}

export function getBdcMaxTier(override?: number): number {
  if (override != null && !Number.isNaN(override)) return override;
  return env.bdcMaxTier;
}

/** BDC_MAX_TIER applies only to providers with `_bdcMeta`. Others always match. */
export function providerMatchesTier(provider: Provider, maxTier: number): boolean {
  const tier = getProviderActivationTier(provider);
  if (tier == null) return true;
  return tier <= maxTier;
}

export async function filterProvidersByTier(
  providers: Provider[],
  maxTier: number,
): Promise<Provider[]> {
  return providers.filter((p) => !isOsintAdapterProvider(p) && providerMatchesTier(p, maxTier));
}

export function partitionBureauProviders(providers: Provider[]): {
  primary: Provider[];
  complementary: Provider[];
} {
  const primary: Provider[] = [];
  const complementary: Provider[] = [];
  for (const provider of providers) {
    if (isBigDataCorpProvider(provider)) primary.push(provider);
    else complementary.push(provider);
  }
  return { primary, complementary };
}

export type { DocumentType };
