import type { IntelDossierResponse } from '../../contracts/types/intel-dossier.types.js';
import { pruneEmptyDeep } from '../../contracts/utils/prune.util.js';

/** Prune empty fields but keep intel contract arrays/objects stable for clients. */
export function serializeIntelDossierResponse(dossier: IntelDossierResponse): IntelDossierResponse {
  const pruned = pruneEmptyDeep(dossier, {
    preserveKeys: ['findings', 'sources', 'riskBrief', 'intelBrief'],
  }) as IntelDossierResponse;

  return {
    ...pruned,
    findings: pruned.findings ?? [],
    sources: pruned.sources ?? [],
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
