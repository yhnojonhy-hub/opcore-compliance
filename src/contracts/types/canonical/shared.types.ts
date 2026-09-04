export interface Lawsuit {
  court: string | null;
  type: string | null;
  status: string | null;
  amount: number | null;
  caseNumber?: string | null;
  filedAt?: string | null;
  source?: string | null;
}

export interface Protest {
  amount: number | null;
  status: string | null;
  date: string | null;
  registry?: string | null;
  city?: string | null;
  state?: string | null;
}

export interface SanctionHit {
  source: string;
  type: string | null;
  sanctionType: string | null;
  matchRate: number | null;
  matchConfidence?: 'confirmed' | 'possible' | 'weak';
  originalName: string | null;
  sanctionName: string | null;
  birthDate?: string | null;
  isPresent?: boolean;
  startDate?: string | null;
  endDate?: string | null;
  details?: Record<string, unknown>;
}

export interface RestrictiveListHit {
  list: string | null;
  reason: string | null;
  status: string | null;
  startDate?: string | null;
  endDate?: string | null;
  details?: Record<string, unknown>;
}

export interface UboNode {
  document: string | null;
  name: string | null;
  level: number;
  children: UboNode[];
}

export type PhoneType = 'mobile' | 'landline';

export interface Phone {
  ddd: number | null;
  number: string | null;
  type: PhoneType | null;
  ranking: number | null;
  whatsapp: boolean | null;
  plus: boolean | null;
}

export interface EmailContact {
  email: string | null;
  ranking: number | null;
  hasCookie: boolean | null;
}

export interface Address {
  line: string | null;
  streetType: string | null;
  streetTitle: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  type: string | null;
  ranking: number | null;
}

export interface Vehicle {
  plate: string | null;
  makeModel: string | null;
  manufactureYear: number | null;
  modelYear: number | null;
  renavam: string | null;
  chassis: string | null;
  licensingDate: string | null;
  ranking: number | null;
}

export interface RelatedPerson {
  document: string | null;
  name: string | null;
  relationType: string | null;
}

export interface Shareholding {
  name: string | null;
  document: string | null;
  capital: number | null;
  sharePercent: number | null;
  foundedDate: string | null;
  cadastralStatus: string | null;
}
