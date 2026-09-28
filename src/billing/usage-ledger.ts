import { prisma } from '../db/prisma.js';
import {
  LEMIT_CREDITS_PER_CALL,
  bdcBasePrice,
  vendorForSlug,
  type BillingVendor,
} from './prices.js';

export interface UsageEventInput {
  providerSlug: string;
  dataset?: string | null;
  credits?: number | null;
  vendor?: BillingVendor;
}

/** Nunca derruba a consulta: falha ao gravar o ledger só é logada. */
export async function recordProviderUsage(input: UsageEventInput): Promise<void> {
  if (process.env.VITEST === 'true') return;
  const vendor = input.vendor ?? vendorForSlug(input.providerSlug);
  if (!vendor) return;

  const credits =
    input.credits ?? (vendor === 'lemit' ? LEMIT_CREDITS_PER_CALL : vendor === 'apollo' ? 1 : null);
  const unitCostBrl = vendor === 'bigdatacorp' ? bdcBasePrice(input.providerSlug) : null;

  try {
    await prisma.providerUsageEvent.create({
      data: {
        vendor,
        providerSlug: input.providerSlug,
        dataset: input.dataset ?? null,
        credits,
        unitCostBrl,
      },
    });
  } catch (err) {
    console.warn('[billing] falha ao registrar uso de provedor', input.providerSlug, err);
  }
}

export function startOfMonth(date = new Date()): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export async function countUsageBySlug(
  vendor: BillingVendor,
  since: Date,
): Promise<Record<string, number>> {
  const rows = await prisma.providerUsageEvent.groupBy({
    by: ['providerSlug'],
    where: { vendor, createdAt: { gte: since } },
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((row) => [row.providerSlug, row._count._all]));
}

export async function sumCredits(vendor: BillingVendor, since: Date): Promise<number> {
  const agg = await prisma.providerUsageEvent.aggregate({
    where: { vendor, createdAt: { gte: since } },
    _sum: { credits: true },
  });
  return Number(agg._sum.credits ?? 0);
}
