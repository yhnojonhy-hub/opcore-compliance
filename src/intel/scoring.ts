import type { SourceReliability } from '../contracts/enums/intel.enums.js';

const RELIABILITY_WEIGHT: Record<SourceReliability, number> = {
  OFFICIAL: 1,
  COMMUNITY: 0.85,
  THIRD_PARTY: 0.7,
  SCRAPING: 0.5,
  PAID: 0.9,
};

export interface ScorableFinding {
  confidence: number;
  reliability: SourceReliability;
  verified: boolean;
  occurredAt?: Date | null;
}

export function scoreFinding(finding: ScorableFinding): number {
  let score = finding.confidence * RELIABILITY_WEIGHT[finding.reliability];
  if (finding.verified) score += 15;
  if (finding.occurredAt) {
    const years = (Date.now() - finding.occurredAt.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    if (years > 2) score -= 10;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function scoreDossier(
  findings: Array<{
    confidence: number;
    reliability: SourceReliability;
    verified: boolean;
    occurredAt?: Date | null;
  }>,
): number {
  const usable = findings.filter((finding) => finding.confidence >= 50);
  if (usable.length === 0) return 50;
  const values = usable.map((finding) => scoreFinding(finding));
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function classifyScore(score: number): 'ALTA' | 'MEDIA' | 'BAIXA' {
  if (score >= 80) return 'ALTA';
  if (score >= 50) return 'MEDIA';
  return 'BAIXA';
}

export function markCrossValidated<T extends { title: string; summary: string }>(
  findings: T[],
): Array<T & { verified: boolean }> {
  const counts = new Map<string, number>();
  for (const finding of findings) {
    const key = `${finding.title}|${finding.summary}`.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return findings.map((finding) => ({
    ...finding,
    verified: (counts.get(`${finding.title}|${finding.summary}`.toLowerCase()) ?? 0) > 1,
  }));
}
