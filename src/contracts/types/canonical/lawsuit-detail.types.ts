export interface LawsuitMovementComplement {
  code: number | null;
  name: string | null;
  description: string | null;
  value: string | null;
}

export interface LawsuitMovement {
  id: string;
  date: string;
  code: number;
  name: string;
  degree: string | null;
  complements: LawsuitMovementComplement[];
  source: string;
}

export type LawsuitSourceStatus = 'ok' | 'not_found' | 'error' | 'skipped';

export interface LawsuitSourceReport {
  name: string;
  status: LawsuitSourceStatus;
  error?: string;
  detail?: string;
}

export interface LawsuitInstance {
  tribunal: string;
  degree: string | null;
  organ: string | null;
  className: string | null;
  subjects: string[];
  filedAt: string | null;
  updatedAt: string | null;
  system: string | null;
}

/** Registro consolidado de um processo, montado a partir de todas as fontes OpCore. */
export interface LawsuitDetail {
  number: string;
  formattedNumber: string;
  found: boolean;
  tribunal: string | null;
  court: string | null;
  className: string | null;
  subjects: string[];
  organ: string | null;
  degree: string | null;
  filedAt: string | null;
  lastUpdateAt: string | null;
  status: string | null;
  type: string | null;
  amount: number | null;
  instances: LawsuitInstance[];
  movements: LawsuitMovement[];
  sources: LawsuitSourceReport[];
  fetchedAt: string;
  cached: boolean;
}
