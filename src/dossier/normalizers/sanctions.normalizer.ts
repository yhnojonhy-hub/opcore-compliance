import { env } from '../../lib/env.js';
import { asRecord } from '../../providers/adapters/http.util.js';
import { readNumber, readString } from './read.util.js';

export type SanctionMatchConfidence = 'confirmed' | 'possible' | 'weak';

export interface NormalizedSanctionHit {
  source: string;
  type: string | null;
  sanctionType: string | null;
  matchRate: number | null;
  matchConfidence: SanctionMatchConfidence;
  originalName: string | null;
  sanctionName: string | null;
  birthDate: string | null;
  isPresent: boolean;
  startDate: string | null;
  endDate: string | null;
  details: Record<string, unknown>;
}

const SANCTION_LIST_PATHS = new Set([
  'sections.pldft.sanctionsHits',
  'sections.sanctions.internationalHits',
]);

const CONFIRMED_FLAG_PATHS: Record<string, string> = {
  'sections.pldft.sanctionsHits': 'sections.pldft.isSanctioned',
  'sections.sanctions.internationalHits': 'sections.sanctions.isCurrentlySanctioned',
};

const CONFIRMED_LIST_SUFFIX = 'Confirmed';

export function getSanctionsConfirmedMatchRate(): number {
  return env.bdcSanctionsConfirmedMatchRate;
}

export function classifyMatchRate(matchRate: number | null): SanctionMatchConfidence {
  if (matchRate == null) return 'weak';
  const confirmedFrom = getSanctionsConfirmedMatchRate();
  if (matchRate >= confirmedFrom) return 'confirmed';
  if (matchRate >= 70) return 'possible';
  return 'weak';
}

export function isBdcSanctionRecord(item: unknown): boolean {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  const record = item as Record<string, unknown>;
  return (
    'Source' in record ||
    'MatchRate' in record ||
    'StandardizedSanctionType' in record ||
    'SanctionName' in record
  );
}

export function normalizeBdcSanctionHit(raw: unknown): NormalizedSanctionHit {
  const record = asRecord(raw);
  const details = asRecord(record.Details);
  const normalized = asRecord(record.NormalizedDetails);

  const matchRate = readNumber(record.MatchRate, record.matchRate);
  const source = readString(record.Source, record.source) ?? 'unknown';
  const originalName = readString(
    details.OriginalName,
    normalized.OriginalName,
    record.OriginalName,
  );
  const sanctionName = readString(
    details.SanctionName,
    normalized.SanctionName,
    record.SanctionName,
    record.title,
  );

  return {
    source: source.toLowerCase(),
    type: readString(record.Type, record.type),
    sanctionType: readString(record.StandardizedSanctionType, record.sanctionType),
    matchRate,
    matchConfidence: classifyMatchRate(matchRate),
    originalName,
    sanctionName,
    birthDate: readString(
      details.StandardizedBirthDate,
      normalized.StandardizedBirthDate,
      details.BirthDate,
      normalized.BirthDate,
    ),
    isPresent: record.IsCurrentlyPresentOnSource !== false,
    startDate: readString(record.StartDate),
    endDate: readString(record.EndDate),
    details: { ...record, ...details },
  };
}

export function normalizeSanctionList(items: unknown[]): {
  all: NormalizedSanctionHit[];
  confirmed: NormalizedSanctionHit[];
  possible: NormalizedSanctionHit[];
  maxMatchRate: number | null;
} {
  const all = items.map((item) =>
    isBdcSanctionRecord(item) ? normalizeBdcSanctionHit(item) : (item as NormalizedSanctionHit),
  );
  const confirmed = all.filter(
    (item) => item.matchConfidence === 'confirmed' && item.isPresent !== false,
  );
  const possible = all.filter((item) => item.matchConfidence === 'possible');
  const rates = all.map((item) => item.matchRate).filter((rate): rate is number => rate != null);
  const maxMatchRate = rates.length > 0 ? Math.max(...rates) : null;
  return { all, confirmed, possible, maxMatchRate };
}

const INTERNATIONAL_HITS_PATH = 'sections.sanctions.internationalHits';

function isOwnersKycContainer(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    'OwnersKycData' in record ||
    'PeopleOwnersKycData' in record ||
    'CompanyOwnersKycData' in record ||
    'TotalCurrentlySanctioned' in record
  );
}

export function flattenOwnersKycSanctions(container: Record<string, unknown>): unknown[] {
  const hits: unknown[] = [];
  const ownerMaps = [
    container.OwnersKycData,
    container.PeopleOwnersKycData,
    container.CompanyOwnersKycData,
  ];

  for (const map of ownerMaps) {
    if (!map || typeof map !== 'object' || Array.isArray(map)) continue;
    for (const ownerData of Object.values(map as Record<string, unknown>)) {
      if (!ownerData || typeof ownerData !== 'object') continue;
      const sanctions = (ownerData as Record<string, unknown>).SanctionsHistory;
      if (Array.isArray(sanctions)) hits.push(...sanctions);
    }
  }

  return hits;
}

function applyOwnersKycSummaryFlags(
  mapped: Record<string, unknown>,
  container: Record<string, unknown>,
): void {
  const pepPath = 'sections.sanctions.isCurrentlyPep';
  const sanctionedPath = 'sections.sanctions.isCurrentlySanctioned';
  const prevPath = 'sections.sanctions.wasPreviouslySanctioned';

  if (mapped[pepPath] == null && container.TotalCurrentlyPEP != null) {
    mapped[pepPath] = Number(container.TotalCurrentlyPEP) > 0;
  }
  if (mapped[sanctionedPath] == null && container.TotalCurrentlySanctioned != null) {
    mapped[sanctionedPath] = Number(container.TotalCurrentlySanctioned) > 0;
  }
  if (mapped[prevPath] == null && container.TotalHistoricallySanctioned != null) {
    mapped[prevPath] = Number(container.TotalHistoricallySanctioned) > 0;
  }
}

export function normalizeOwnersKycInMapped(mapped: Record<string, unknown>): void {
  const value = mapped[INTERNATIONAL_HITS_PATH];
  if (!isOwnersKycContainer(value)) return;

  const container = value;
  const hits = flattenOwnersKycSanctions(container);
  if (hits.length > 0) {
    mapped[INTERNATIONAL_HITS_PATH] = hits;
  } else {
    delete mapped[INTERNATIONAL_HITS_PATH];
  }
  applyOwnersKycSummaryFlags(mapped, container);
}

export function normalizeSanctionsInMapped(mapped: Record<string, unknown>): void {
  normalizeOwnersKycInMapped(mapped);

  for (const path of SANCTION_LIST_PATHS) {
    const value = mapped[path];
    if (!Array.isArray(value) || value.length === 0) continue;

    const { all, confirmed, maxMatchRate } = normalizeSanctionList(value);
    mapped[path] = all;
    mapped[`${path}${CONFIRMED_LIST_SUFFIX}`] = confirmed;

    const flagPath = CONFIRMED_FLAG_PATHS[path];
    if (!flagPath) continue;

    const bdcFlag = mapped[flagPath];
    const hasConfirmed = confirmed.length > 0;
    mapped[flagPath] =
      hasConfirmed || (bdcFlag === true && (maxMatchRate ?? 0) >= getSanctionsConfirmedMatchRate());

    mapped[`${flagPath}BdcRaw`] = bdcFlag === true;
    mapped[`${path}Summary`] = {
      total: all.length,
      confirmed: confirmed.length,
      possible: all.filter((item) => item.matchConfidence === 'possible').length,
      weak: all.filter((item) => item.matchConfidence === 'weak').length,
      maxMatchRate,
      confirmedMatchRateThreshold: getSanctionsConfirmedMatchRate(),
    };
  }
}

export function normalizeSanctionFinding(details: Record<string, unknown>, sourceName: string) {
  if (isBdcSanctionRecord(details)) return normalizeBdcSanctionHit(details);
  return {
    source: sourceName.toLowerCase(),
    type: readString(details.type, details.Type),
    sanctionType: readString(details.sanctionType, details.category),
    matchRate: readNumber(details.matchRate, details.score),
    matchConfidence: 'possible' as const,
    originalName: readString(details.name, details.originalName, details.caption),
    sanctionName: readString(details.sanctionName, details.title, details.caption),
    birthDate: readString(details.birthDate),
    isPresent: true,
    startDate: readString(details.startDate),
    endDate: readString(details.endDate),
    details,
  };
}
