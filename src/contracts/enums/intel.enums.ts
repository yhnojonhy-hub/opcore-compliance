export const TARGET_TYPES = ['CPF', 'CNPJ', 'PHONE', 'EMAIL', 'NAME', 'PASSAPORTE'] as const;
export type TargetType = (typeof TARGET_TYPES)[number];
/** @deprecated Use TargetType — alias for juridico port compatibility */
export type DossierTargetType = TargetType;

export const FINDING_CATEGORIES = [
  'IDENTITY',
  'ADDRESS',
  'SANCTION',
  'LAWSUIT',
  'MANDADO',
  'INTIMACAO',
  'FINANCIAL',
  'SOCIAL_PRESENCE',
  'NEWS',
  'BREACH',
  'DOMAIN',
  'ELECTORAL',
  'REPUTATION',
  'TRAVEL_DOC',
] as const;
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];

export const SOURCE_RELIABILITIES = [
  'OFFICIAL',
  'COMMUNITY',
  'THIRD_PARTY',
  'SCRAPING',
  'PAID',
] as const;
export type SourceReliability = (typeof SOURCE_RELIABILITIES)[number];

export const INTEL_DOSSIER_STATUSES = ['PENDING', 'PARTIAL', 'COMPLETED', 'FAILED'] as const;
export type IntelDossierStatus = (typeof INTEL_DOSSIER_STATUSES)[number];

export const DOSSIER_PURPOSES = ['KYC', 'PRE_CONTRACT', 'MA', 'LITIGATION', 'CREDIT'] as const;
export type DossierPurpose = (typeof DOSSIER_PURPOSES)[number];

export const DOSSIER_LEGAL_BASES = [
  'CONTRACT',
  'LEGAL_RIGHTS',
  'LEGITIMATE_INTEREST',
  'CREDIT_PROTECTION',
] as const;
export type DossierLegalBasis = (typeof DOSSIER_LEGAL_BASES)[number];
