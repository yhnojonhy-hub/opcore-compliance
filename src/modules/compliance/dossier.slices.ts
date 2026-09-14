import type { DocumentType } from '@prisma/client';
import type {
  ComplianceDossier,
  DossierMeta,
  PfSections,
  PjSections,
} from '../../contracts/types/compliance-dossier.types.js';
import { pruneEmptyDeep } from '../../contracts/utils/prune.util.js';

export type SliceDocumentType = 'CPF' | 'CNPJ' | 'BOTH';

export interface SliceCatalogEntry {
  id: string;
  description: string;
  documentTypes: SliceDocumentType;
}

export interface SliceEnvelope {
  document: string;
  documentType: DocumentType;
  slice: string;
  meta: Pick<DossierMeta, 'dossierId' | 'generatedAt' | 'hash' | 'completeness'>;
  data: Record<string, unknown>;
}

type SliceProjector = (dossier: ComplianceDossier) => Record<string, unknown>;

function isPf(dossier: ComplianceDossier): boolean {
  return dossier.subject.type === 'PF';
}

function pfSections(dossier: ComplianceDossier): PfSections {
  return dossier.sections as PfSections;
}

function pjSections(dossier: ComplianceDossier): PjSections {
  return dossier.sections as PjSections;
}

function identityData(dossier: ComplianceDossier): Record<string, unknown> {
  if (isPf(dossier)) {
    const c = pfSections(dossier).cadastral;
    return {
      fullName: dossier.subject.type === 'PF' ? dossier.subject.fullName : null,
      cpfStatus: c.cpfStatus,
      cpfRegular: c.cpfRegular,
      birthDate: c.birthDate,
      motherName: c.motherName,
      gender: c.gender,
      deceased: c.deceased,
      occupation: c.occupation,
    };
  }
  const c = pjSections(dossier).cadastral;
  return {
    legalName: dossier.subject.type === 'PJ' ? dossier.subject.legalName : null,
    tradeName: dossier.subject.type === 'PJ' ? dossier.subject.tradeName : null,
    cnpjStatus: c.cnpjStatus,
    openingDate: c.openingDate,
    companyType: c.companyType,
  };
}

function contactsData(dossier: ComplianceDossier): Record<string, unknown> {
  if (isPf(dossier)) {
    const c = pfSections(dossier).cadastral;
    return {
      fullName: dossier.subject.type === 'PF' ? dossier.subject.fullName : c.fullName,
      phones: c.phones ?? [],
      emails: c.emails ?? [],
    };
  }
  const c = pjSections(dossier).cadastral;
  return {
    legalName: dossier.subject.type === 'PJ' ? dossier.subject.legalName : c.legalName,
    tradeName: dossier.subject.type === 'PJ' ? dossier.subject.tradeName : c.tradeName,
    phones: c.phones ?? [],
    emails: c.emails ?? [],
  };
}

function addressesData(dossier: ComplianceDossier): Record<string, unknown> {
  const cadastral = isPf(dossier) ? pfSections(dossier).cadastral : pjSections(dossier).cadastral;
  return { addresses: cadastral.addresses ?? [] };
}

function vehiclesData(dossier: ComplianceDossier): Record<string, unknown> {
  const cadastral = isPf(dossier) ? pfSections(dossier).cadastral : pjSections(dossier).cadastral;
  return { vehicles: cadastral.vehicles ?? [] };
}

function cadastralData(dossier: ComplianceDossier): Record<string, unknown> {
  return {
    cadastral: isPf(dossier) ? pfSections(dossier).cadastral : pjSections(dossier).cadastral,
  };
}

function lawsuitsData(dossier: ComplianceDossier): Record<string, unknown> {
  if (isPf(dossier)) {
    const lit = pfSections(dossier).litigation;
    return {
      lawsuits: lit.lawsuits ?? [],
      criminalRecords: lit.criminalRecords ?? [],
    };
  }
  return { lawsuits: pjSections(dossier).litigationEsg.lawsuits ?? [] };
}

function protestsData(dossier: ComplianceDossier): Record<string, unknown> {
  if (isPf(dossier)) {
    return { protests: pfSections(dossier).financial.protests ?? [] };
  }
  return { protests: pjSections(dossier).fiscalHealth.protests ?? [] };
}

function sanctionsData(dossier: ComplianceDossier): Record<string, unknown> {
  if (isPf(dossier)) {
    const p = pfSections(dossier).pldft;
    return {
      isPep: p.isPep,
      pepLevel: p.pepLevel,
      pepRelated: p.pepRelated,
      isSanctioned: p.isSanctioned,
      sanctionsHits: p.sanctionsHits ?? [],
      sanctionsHitsConfirmed: p.sanctionsHitsConfirmed ?? [],
      restrictiveListHits: p.restrictiveListHits ?? [],
    };
  }
  return { ...pjSections(dossier).sanctions };
}

function esgData(dossier: ComplianceDossier): Record<string, unknown> {
  if (isPf(dossier)) {
    return { ...pfSections(dossier).esg };
  }
  const lit = pjSections(dossier).litigationEsg;
  return {
    laborCompliance: lit.laborCompliance,
    environmentalEmbargoes: lit.environmentalEmbargoes ?? [],
  };
}

function pldftData(dossier: ComplianceDossier): Record<string, unknown> {
  return { ...pfSections(dossier).pldft };
}

function financialData(dossier: ComplianceDossier): Record<string, unknown> {
  return { ...pfSections(dossier).financial };
}

function corporateLinksData(dossier: ComplianceDossier): Record<string, unknown> {
  return { ...pfSections(dossier).corporateLinks };
}

function qsaData(dossier: ComplianceDossier): Record<string, unknown> {
  return { qsa: pjSections(dossier).corporateStructure.qsa ?? [] };
}

function uboData(dossier: ComplianceDossier): Record<string, unknown> {
  return { uboTree: pjSections(dossier).corporateStructure.uboTree ?? [] };
}

function corporateStructureData(dossier: ComplianceDossier): Record<string, unknown> {
  return { ...pjSections(dossier).corporateStructure };
}

function fiscalHealthData(dossier: ComplianceDossier): Record<string, unknown> {
  return { ...pjSections(dossier).fiscalHealth };
}

function certificatesData(dossier: ComplianceDossier): Record<string, unknown> {
  return { ...pjSections(dossier).certificates };
}

function creditData(dossier: ComplianceDossier): Record<string, unknown> {
  return { ...pjSections(dossier).credit };
}

function cnaeData(dossier: ComplianceDossier): Record<string, unknown> {
  const c = pjSections(dossier).cadastral;
  return {
    cnae: c.cnae,
    cnaeMatch: c.cnaeMatch,
    cnaeDescription: c.cnaeDescription,
    companyType: c.companyType,
  };
}

const PROJECTORS: Record<string, SliceProjector> = {
  identity: identityData,
  contacts: contactsData,
  addresses: addressesData,
  vehicles: vehiclesData,
  cadastral: cadastralData,
  lawsuits: lawsuitsData,
  protests: protestsData,
  sanctions: sanctionsData,
  esg: esgData,
  pldft: pldftData,
  financial: financialData,
  'corporate-links': corporateLinksData,
  qsa: qsaData,
  ubo: uboData,
  'corporate-structure': corporateStructureData,
  'fiscal-health': fiscalHealthData,
  certificates: certificatesData,
  credit: creditData,
  cnae: cnaeData,
};

/** Catalog of named dossier slices (excludes reserved paths `risk` and `full`). */
export const DOSSIER_SLICES: SliceCatalogEntry[] = [
  { id: 'identity', description: 'Nome e status cadastral', documentTypes: 'BOTH' },
  { id: 'contacts', description: 'Nome, telefones e e-mails', documentTypes: 'BOTH' },
  { id: 'addresses', description: 'Endereços cadastrais', documentTypes: 'BOTH' },
  { id: 'vehicles', description: 'Veículos', documentTypes: 'BOTH' },
  { id: 'cadastral', description: 'Bloco cadastral completo', documentTypes: 'BOTH' },
  { id: 'lawsuits', description: 'Processos judiciais (e antecedentes PF)', documentTypes: 'BOTH' },
  { id: 'protests', description: 'Protestos', documentTypes: 'BOTH' },
  { id: 'sanctions', description: 'Sanções e listas restritivas', documentTypes: 'BOTH' },
  { id: 'esg', description: 'ESG / embargoes ambientais', documentTypes: 'BOTH' },
  { id: 'pldft', description: 'PLDFT / PEP (somente PF)', documentTypes: 'CPF' },
  { id: 'financial', description: 'Dados financeiros (somente PF)', documentTypes: 'CPF' },
  { id: 'corporate-links', description: 'Vínculos societários (somente PF)', documentTypes: 'CPF' },
  { id: 'qsa', description: 'Quadro societário (somente PJ)', documentTypes: 'CNPJ' },
  { id: 'ubo', description: 'Árvore UBO (somente PJ)', documentTypes: 'CNPJ' },
  {
    id: 'corporate-structure',
    description: 'Estrutura societária completa (somente PJ)',
    documentTypes: 'CNPJ',
  },
  { id: 'fiscal-health', description: 'Saúde fiscal (somente PJ)', documentTypes: 'CNPJ' },
  { id: 'certificates', description: 'Certidões e débitos (somente PJ)', documentTypes: 'CNPJ' },
  { id: 'credit', description: 'Crédito e restrições (somente PJ)', documentTypes: 'CNPJ' },
  { id: 'cnae', description: 'CNAE e tipo societário (somente PJ)', documentTypes: 'CNPJ' },
];

const SLICE_BY_ID = new Map(DOSSIER_SLICES.map((s) => [s.id, s]));

export function listDossierSlices(): SliceCatalogEntry[] {
  return DOSSIER_SLICES;
}

export function getSliceCatalogEntry(sliceId: string): SliceCatalogEntry | undefined {
  return SLICE_BY_ID.get(sliceId);
}

export function isSliceCompatible(sliceId: string, documentType: DocumentType): boolean {
  const entry = SLICE_BY_ID.get(sliceId);
  if (!entry) return false;
  if (entry.documentTypes === 'BOTH') return true;
  return entry.documentTypes === documentType;
}

export function projectDossierSlice(
  dossier: ComplianceDossier,
  sliceId: string,
): Record<string, unknown> {
  const projector = PROJECTORS[sliceId];
  if (!projector) {
    throw new Error(`Unknown dossier slice: ${sliceId}`);
  }
  return projector(dossier);
}

export function buildSliceEnvelope(dossier: ComplianceDossier, sliceId: string): SliceEnvelope {
  const data = pruneEmptyDeep(projectDossierSlice(dossier, sliceId));
  return {
    document: dossier.meta.document,
    documentType: dossier.meta.documentType,
    slice: sliceId,
    meta: {
      dossierId: dossier.meta.dossierId,
      generatedAt: dossier.meta.generatedAt,
      hash: dossier.meta.hash,
      completeness: dossier.meta.completeness,
    },
    data: (data ?? {}) as Record<string, unknown>,
  };
}
