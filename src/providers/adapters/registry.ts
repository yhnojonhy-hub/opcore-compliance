import { sourceCite } from '../../intel/brief.js';
import type { DossierProvider } from './types.js';
import { DOSSIER_PROVIDERS, providersFor, isValidTarget } from './osint/catalog.js';

export { providersFor, isValidTarget, DOSSIER_PROVIDERS };

export function slugForProvider(name: string): string {
  return `osint-${sourceCite(name)}`;
}

const registry = new Map<string, DossierProvider>(
  DOSSIER_PROVIDERS.map((provider) => [slugForProvider(provider.name), provider]),
);

export function getAdapterByRef(adapterRef: string): DossierProvider | undefined {
  return registry.get(adapterRef);
}

export function getAdapterByName(name: string): DossierProvider | undefined {
  return registry.get(slugForProvider(name));
}

export function listAdapterRefs(): string[] {
  return [...registry.keys()];
}

export interface AdapterMeta {
  adapterRef: string;
  name: string;
  category: string;
  reliability: string;
  phase: 'sync' | 'async';
  accepts: string[];
}

export function listAdapterMeta(): AdapterMeta[] {
  return DOSSIER_PROVIDERS.map((provider) => ({
    adapterRef: slugForProvider(provider.name),
    name: provider.name,
    category: provider.category,
    reliability: provider.reliability,
    phase: provider.phase,
    accepts: [...provider.accepts],
  }));
}
