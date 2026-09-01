import type {
  DossierTargetType,
  FindingCategory,
  SourceReliability,
} from '../../contracts/enums/intel.enums.js';

export interface ProviderContext {
  target: string;
  targetType: DossierTargetType;
  partyName?: string;
  aliases: string[];
  deepSearch: boolean;
  paidProviders: string[];
  priorFindings: Array<{
    category: FindingCategory;
    title: string;
    summary: string;
    details: Record<string, unknown>;
  }>;
}

export interface ProviderFinding {
  category: FindingCategory;
  title: string;
  summary: string;
  details: Record<string, unknown>;
  confidence: number;
  url?: string;
  occurredAt?: Date;
}

export interface ProviderResult {
  status: 'ok' | 'error' | 'skipped' | 'rate_limited';
  httpStatus?: number;
  error?: string;
  rawPayload?: unknown;
  findings: ProviderFinding[];
}

export interface DossierProvider {
  name: string;
  category: FindingCategory;
  reliability: SourceReliability;
  accepts: DossierTargetType[];
  phase: 'sync' | 'async';
  rateMs: number;
  run(ctx: ProviderContext): Promise<ProviderResult>;
}
