import { BDC_BASE_PRICE_BRL } from './bdc-prices.data.js';

export type BillingVendor = 'bigdatacorp' | 'lemit' | 'apollo';

/** Lemit debita 0,12 crédito por consulta pessoa/empresa (homolog 04/09/2026, docs/LEMIT.md §11). */
export const LEMIT_CREDITS_PER_CALL = 0.12;

/**
 * Faixas de desconto sobre o volume mensal total (docs BDC "Descontos por volume de consumo").
 * Acima de 1M a BDC aplica teto por dataset; tratado como a última faixa percentual.
 */
const BDC_VOLUME_DISCOUNTS: Array<{ upTo: number; discount: number }> = [
  { upTo: 10_000, discount: 0 },
  { upTo: 50_000, discount: 0.05 },
  { upTo: 100_000, discount: 0.0975 },
  { upTo: 500_000, discount: 0.1426 },
  { upTo: 1_000_000, discount: 0.1855 },
  { upTo: Number.POSITIVE_INFINITY, discount: 0.2262 },
];

export function vendorForSlug(slug: string): BillingVendor | null {
  if (slug.startsWith('bigdatacorp-')) return 'bigdatacorp';
  if (slug.startsWith('lemit-')) return 'lemit';
  if (slug === 'osint-apollo-io') return 'apollo';
  return null;
}

export function bdcBasePrice(slug: string): number | null {
  return BDC_BASE_PRICE_BRL[slug] ?? null;
}

export function bdcVolumeDiscount(monthlyRequests: number): number {
  return BDC_VOLUME_DISCOUNTS.find((tier) => monthlyRequests <= tier.upTo)?.discount ?? 0;
}

export interface BdcMonthEstimate {
  requests: number;
  grossBrl: number;
  discount: number;
  estimatedBrl: number;
  unpricedRequests: number;
  bySlug: Array<{ slug: string; requests: number; unitBrl: number | null; grossBrl: number }>;
}

export function estimateBdcMonth(countsBySlug: Record<string, number>): BdcMonthEstimate {
  const bySlug = Object.entries(countsBySlug)
    .map(([slug, requests]) => {
      const unitBrl = bdcBasePrice(slug);
      return { slug, requests, unitBrl, grossBrl: round2((unitBrl ?? 0) * requests) };
    })
    .sort((a, b) => b.grossBrl - a.grossBrl);

  const requests = bySlug.reduce((sum, row) => sum + row.requests, 0);
  const grossBrl = round2(bySlug.reduce((sum, row) => sum + row.grossBrl, 0));
  const discount = bdcVolumeDiscount(requests);
  const unpricedRequests = bySlug
    .filter((row) => row.unitBrl === null)
    .reduce((sum, row) => sum + row.requests, 0);

  return {
    requests,
    grossBrl,
    discount,
    estimatedBrl: round2(grossBrl * (1 - discount)),
    unpricedRequests,
    bySlug,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
