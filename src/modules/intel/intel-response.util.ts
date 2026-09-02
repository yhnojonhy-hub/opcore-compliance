import type { IntelDossierResponse } from '../../contracts/types/intel-dossier.types.js';
import { pruneEmptyDeep } from '../../contracts/utils/prune.util.js';

/** Prune empty fields but keep intel contract arrays/objects stable for clients. */
export function serializeIntelDossierResponse(dossier: IntelDossierResponse): IntelDossierResponse {
  const pruned = pruneEmptyDeep(dossier, {
    preserveKeys: [
      'findings',
      'sources',
      'riskBrief',
      'intelBrief',
      'pillars',
      'canonical',
      'consultedAbsent',
      'CHECKED_ABSENT',
      'details',
    ],
  }) as IntelDossierResponse;

  // Keep absence findings even if prune would drop sparse details
  const findings = (dossier.findings ?? []).filter((finding) => {
    if (finding.title.trim() || finding.summary.trim()) return true;
    return Boolean(finding.details?.consultedAbsent);
  });

  return {
    ...pruned,
    findings,
    sources: pruned.sources ?? dossier.sources ?? [],
    pillars: dossier.pillars ?? pruned.pillars,
    canonical: dossier.canonical ?? pruned.canonical ?? null,
    riskBrief: {
      overall: pruned.riskBrief?.overall ?? 'GREEN',
      categories: pruned.riskBrief?.categories ?? [],
    },
    intelBrief: {
      headline: pruned.intelBrief?.headline ?? '',
      estimative: pruned.intelBrief?.estimative ?? '',
      confidence: pruned.intelBrief?.confidence ?? 'baixa',
      judgements: pruned.intelBrief?.judgements ?? [],
      checkedAbsent: pruned.intelBrief?.checkedAbsent ?? [],
      gaps: pruned.intelBrief?.gaps ?? [],
    },
  };
}
