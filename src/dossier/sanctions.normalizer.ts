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
  const raw = process.env.BDC_SANCTIONS_CONFIRMED_MATCH_RATE;
  const parsed = raw ? Number(raw) : 85;
  return Number.isFinite(parsed) ? parsed : 85;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function readNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
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

export function normalizeSanctionsInMapped(mapped: Record<string, unknown>): void {
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
