import type { ComplianceStatus } from '../enums/compliance-status.enum.js';
import type { RiskLevel } from '../enums/risk-level.enum.js';

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

export interface PfSections {
  cadastral: Record<string, unknown>;
  pldft: Record<string, unknown>;
  litigation: Record<string, unknown>;
  financial: Record<string, unknown>;
  esg: Record<string, unknown>;
  corporateLinks: Record<string, unknown>;
}

export interface PjSections {
  cadastral: Record<string, unknown>;
  corporateStructure: Record<string, unknown>;
  sanctions: Record<string, unknown>;
  fiscalHealth: Record<string, unknown>;
  litigationEsg: Record<string, unknown>;
}

export interface ComplianceDossier {
  meta: DossierMeta;
  subject: Record<string, unknown>;
  risk: RiskAssessmentResult;
  compliance: ComplianceVerdict;
  sections: PfSections | PjSections;
  sources: DossierSource[];
  audit: DossierAudit;
}

export function emptyPfSections(): PfSections {
  return {
    cadastral: {},
    pldft: {},
    litigation: {},
    financial: {},
    esg: {},
    corporateLinks: {},
  };
}

export function emptyPjSections(): PjSections {
  return {
    cadastral: {},
    corporateStructure: {},
    sanctions: {},
    fiscalHealth: {},
    litigationEsg: {},
  };
}
