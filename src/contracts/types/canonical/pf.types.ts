import type {
  Address,
  EmailContact,
  Lawsuit,
  Phone,
  Protest,
  RelatedPerson,
  RestrictiveListHit,
  SanctionHit,
  Shareholding,
  UboNode,
  Vehicle,
} from './shared.types.js';

export interface PfCadastral {
  fullName: string | null;
  birthDate: string | null;
  motherName: string | null;
  cpfStatus: string | null;
  cpfRegular: boolean | null;
  gender?: string | null;
  deceased?: boolean | null;
  occupation?: string | null;
  phones?: Phone[];
  emails?: EmailContact[];
  addresses?: Address[];
  vehicles?: Vehicle[];
  /** Transient mapping keys — merged into phones by normalizer */
  mobilePhones?: unknown;
  landlinePhones?: unknown;
}

export interface PfPldft {
  isPep: boolean | null;
  pepLevel: string | null;
  pepRelated: boolean | null;
  isSanctioned?: boolean | null;
  sanctionsHits: SanctionHit[];
  sanctionsHitsConfirmed?: SanctionHit[];
  restrictiveListHits: RestrictiveListHit[];
  [key: string]: unknown;
}

export interface PfLitigation {
  criminalRecords: Record<string, unknown>[];
  lawsuits: Lawsuit[];
}

export interface PfFinancial {
  federalDebt: number | null;
  protests: Protest[];
  creditFlags: string[];
  estimatedIncome?: number | null;
  totalAssets?: string | null;
  estimatedIncomeRange?: string | null;
  incomeEstimates?: Record<string, string> | null;
  taxReturns?: Record<string, unknown>[] | null;
  financialRiskScore?: number | null;
  financialRiskLevel?: string | null;
  isCurrentlyOnCollection?: boolean | null;
  collections?: Record<string, unknown> | null;
  occupations?: Record<string, unknown>[] | null;
}

export interface PfEsg {
  slaveLabor: boolean | null;
  environmentalEmbargoes: Record<string, unknown>[];
}

export interface PfCorporateLinks {
  shareholdings: Shareholding[];
  companies: Record<string, unknown>[];
  powersOfAttorney: Record<string, unknown>[];
  relatedPeople?: RelatedPerson[];
}

export interface PfSubject {
  type: 'PF';
  fullName: string | null;
}

export interface PfSections {
  cadastral: PfCadastral;
  pldft: PfPldft;
  litigation: PfLitigation;
  financial: PfFinancial;
  esg: PfEsg;
  corporateLinks: PfCorporateLinks;
}

export function emptyPfCadastral(): PfCadastral {
  return {
    fullName: null,
    birthDate: null,
    motherName: null,
    cpfStatus: null,
    cpfRegular: null,
  };
}

export function emptyPfPldft(): PfPldft {
  return {
    isPep: null,
    pepLevel: null,
    pepRelated: null,
    sanctionsHits: [],
    restrictiveListHits: [],
  };
}

export function emptyPfSections(): PfSections {
  return {
    cadastral: emptyPfCadastral(),
    pldft: emptyPfPldft(),
    litigation: { criminalRecords: [], lawsuits: [] },
    financial: { federalDebt: null, protests: [], creditFlags: [] },
    esg: { slaveLabor: null, environmentalEmbargoes: [] },
    corporateLinks: { shareholdings: [], companies: [], powersOfAttorney: [] },
  };
}

export type { UboNode };
