import type {
  DossierLegalBasis,
  DossierPurpose,
  FindingCategory,
  IntelDossierStatus,
  SourceReliability,
  TargetType,
} from '../enums/intel.enums.js';
import type { DossierIntelBrief, DossierRiskBrief } from '../../intel/brief.js';

export interface IntelFinding {
  id: string;
  category: FindingCategory;
  sourceName: string;
  reliability: SourceReliability;
  confidence: number;
  title: string;
  summary: string;
  details: Record<string, unknown>;
  url?: string | null;
  occurredAt?: string | null;
  verified: boolean;
}

export interface IntelSource {
  id: string;
  name: string;
  providerSlug?: string | null;
  category: FindingCategory;
  reliability: SourceReliability;
  status: string;
  httpStatus?: number | null;
  durationMs?: number | null;
  error?: string | null;
}

export interface IntelDossierResponse {
  id: string;
  target: string;
  targetType: TargetType;
  status: IntelDossierStatus;
  overallScore: number | null;
  scoreLabel: 'ALTA' | 'MEDIA' | 'BAIXA' | null;
  purpose: DossierPurpose;
  legalBasis: DossierLegalBasis;
  deepSearch: boolean;
  partyName?: string | null;
  findings: IntelFinding[];
  sources: IntelSource[];
  riskBrief: DossierRiskBrief;
  intelBrief: DossierIntelBrief;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
}

export interface CreateIntelDossierInput {
  target: string;
  targetType: TargetType;
  deepSearch?: boolean;
  purpose?: DossierPurpose;
  legalBasis?: DossierLegalBasis;
  paidProviders?: string[];
  partyName?: string;
  tenantId?: string;
  requestedBy?: string;
  includeBureau?: boolean;
  forceRefresh?: boolean;
}
