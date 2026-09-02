import type { ComplianceStatus } from '../enums/compliance-status.enum.js';
import type { RiskLevel } from '../enums/risk-level.enum.js';
import type { PfSections, PfSubject } from './canonical/pf.types.js';
import type { PjSections, PjSubject } from './canonical/pj.types.js';
import { emptyPfSections } from './canonical/pf.types.js';
import { emptyPjSections } from './canonical/pj.types.js';

export type { PfSections, PfSubject, PjSections, PjSubject };
export { emptyPfSections, emptyPjSections };

export interface RiskFactor {
  code: string;
  severity: string;
  weight: number;
  description: string;
}

export interface RiskAssessmentResult {
  level: RiskLevel;
  score: number;
  factors: RiskFactor[];
  complianceStatus: ComplianceStatus;
  blocked: boolean;
  requiresManualReview: boolean;
  recommendation: string | null;
}

export interface ComplianceAlert {
  type: string;
  severity: string;
}

export interface ComplianceVerdict {
  status: ComplianceStatus;
  blocked: boolean;
  alerts: ComplianceAlert[];
}

export interface DossierMeta {
  dossierId?: string;
  document: string;
  documentType: 'CPF' | 'CNPJ';
  version: number;
  generatedAt: string;
  completeness: number;
  hash: string;
}

export interface DossierSource {
  providerSlug: string;
  consultedAt: string;
  cacheHit: boolean;
}

export interface DossierAudit {
  requestedBy: string | null;
  reportHash: string;
}

export interface ComplianceDossier {
  meta: DossierMeta;
  subject: PfSubject | PjSubject;
  risk: RiskAssessmentResult;
  compliance: ComplianceVerdict;
  sections: PfSections | PjSections;
  sources: DossierSource[];
  audit: DossierAudit;
}
