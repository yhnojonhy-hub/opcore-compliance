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
