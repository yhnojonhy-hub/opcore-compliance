import type { FindingCategory } from '../contracts/enums/intel.enums.js';
import type { DocumentType } from '@prisma/client';

export interface CanonicalFieldTarget {
  section: string;
  field: string;
}

export const OSINT_CANONICAL_MAP: Record<
  FindingCategory,
  (documentType: DocumentType | null) => CanonicalFieldTarget[]
> = {
  IDENTITY: () => [{ section: 'cadastral', field: 'identityRecords' }],
  ADDRESS: () => [{ section: 'cadastral', field: 'addresses' }],
  SANCTION: (documentType) =>
    documentType === 'CPF'
      ? [{ section: 'pldft', field: 'sanctionsHits' }]
      : [{ section: 'sanctions', field: 'internationalHits' }],
  LAWSUIT: (documentType) =>
    documentType === 'CPF'
      ? [{ section: 'litigation', field: 'lawsuits' }]
      : [{ section: 'litigationEsg', field: 'lawsuits' }],
  MANDADO: (documentType) =>
    documentType === 'CPF'
      ? [{ section: 'litigation', field: 'lawsuits' }]
      : [{ section: 'litigationEsg', field: 'lawsuits' }],
  INTIMACAO: (documentType) =>
    documentType === 'CPF'
      ? [{ section: 'litigation', field: 'lawsuits' }]
      : [{ section: 'litigationEsg', field: 'lawsuits' }],
  FINANCIAL: (documentType) =>
    documentType === 'CPF'
      ? [{ section: 'financial', field: 'protests' }]
      : [
          { section: 'fiscalHealth', field: 'protests' },
          { section: 'credit', field: 'restrictiveFlags' },
        ],
  SOCIAL_PRESENCE: () => [{ section: 'corporateLinks', field: 'companies' }],
  NEWS: (documentType) =>
    documentType === 'CPF'
      ? [{ section: 'litigation', field: 'lawsuits' }]
      : [{ section: 'litigationEsg', field: 'lawsuits' }],
  BREACH: () => [{ section: 'pldft', field: 'restrictiveListHits' }],
  DOMAIN: () => [{ section: 'cadastral', field: 'domains' }],
  ELECTORAL: () => [{ section: 'sanctions', field: 'ceisRecords' }],
  REPUTATION: (documentType) =>
    documentType === 'CPF'
      ? [{ section: 'litigation', field: 'lawsuits' }]
      : [{ section: 'litigationEsg', field: 'lawsuits' }],
  TRAVEL_DOC: (documentType) =>
    documentType === 'CPF'
      ? [
          { section: 'pldft', field: 'sanctionsHits' },
          { section: 'pldft', field: 'restrictiveListHits' },
        ]
      : [{ section: 'sanctions', field: 'internationalHits' }],
};
