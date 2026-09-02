import type { Lawsuit, Protest, SanctionHit, UboNode } from './shared.types.js';

export interface QsaMember {
  name: string | null;
  document: string | null;
  role: string | null;
  sharePercent: number | null;
}

export interface CeisRecord {
  name: string | null;
  reason: string | null;
  startDate: string | null;
  endDate: string | null;
  details?: Record<string, unknown>;
}

export interface CnepPenalty {
  name: string | null;
  reason: string | null;
  startDate: string | null;
  endDate: string | null;
  details?: Record<string, unknown>;
}

export interface PjCadastral {
  legalName: string | null;
  tradeName: string | null;
  cnpjStatus: string | null;
  openingDate: string | null;
  cnae: string | null;
  cnaeMatch: boolean | null;
}

export interface PjCorporateStructure {
  qsa: QsaMember[];
  uboTree: UboNode[];
}

export interface PjSanctions {
  cnepPenalties: CnepPenalty[];
  ceisRecords: CeisRecord[];
  internationalHits: SanctionHit[];
  internationalHitsConfirmed?: SanctionHit[];
  isCurrentlySanctioned?: boolean | null;
  isCurrentlyPep?: boolean | null;
  [key: string]: unknown;
}

export interface PjFiscalHealth {
  bankruptcy: boolean | null;
  judicialRecovery: boolean | null;
  cndFederal: boolean | null;
  cndState: boolean | null;
  cndMunicipal: boolean | null;
  crfFgts: boolean | null;
  protests: Protest[];
}

export interface PjLitigationEsg {
  lawsuits: Lawsuit[];
  laborCompliance: boolean | null;
  environmentalEmbargoes: Record<string, unknown>[];
}

export interface PjCertificates {
  pgfn: unknown;
  fgts: unknown;
  cnj: unknown;
  cgu: unknown;
  ibama: unknown;
  stateDebts: unknown;
  laborDebts: unknown;
  ibamaEmbargoes: unknown;
  laborLawsuits: unknown;
  [key: string]: unknown;
}

export interface PjCredit {
  collectionsPresence: boolean | null;
  scrScore: number | null;
  restrictiveFlags: string[];
  creditScore: number | null;
}

export interface PjSubject {
  type: 'PJ';
  legalName: string | null;
  tradeName: string | null;
}

export interface PjSections {
  cadastral: PjCadastral;
  corporateStructure: PjCorporateStructure;
  sanctions: PjSanctions;
  fiscalHealth: PjFiscalHealth;
  litigationEsg: PjLitigationEsg;
  certificates: PjCertificates;
  credit: PjCredit;
  extensions: Record<string, unknown>;
}

export function emptyPjCadastral(): PjCadastral {
  return {
    legalName: null,
    tradeName: null,
    cnpjStatus: null,
    openingDate: null,
    cnae: null,
    cnaeMatch: null,
  };
}

export function emptyPjSections(): PjSections {
  return {
    cadastral: emptyPjCadastral(),
    corporateStructure: { qsa: [], uboTree: [] },
    sanctions: { cnepPenalties: [], ceisRecords: [], internationalHits: [] },
    fiscalHealth: {
      bankruptcy: null,
      judicialRecovery: null,
      cndFederal: null,
      cndState: null,
      cndMunicipal: null,
      crfFgts: null,
      protests: [],
    },
    litigationEsg: { lawsuits: [], laborCompliance: null, environmentalEmbargoes: [] },
    certificates: {
      pgfn: null,
      fgts: null,
      cnj: null,
      cgu: null,
      ibama: null,
      stateDebts: null,
      laborDebts: null,
      ibamaEmbargoes: null,
      laborLawsuits: null,
    },
    credit: {
      collectionsPresence: null,
      scrScore: null,
      restrictiveFlags: [],
      creditScore: null,
    },
    extensions: {},
  };
}
