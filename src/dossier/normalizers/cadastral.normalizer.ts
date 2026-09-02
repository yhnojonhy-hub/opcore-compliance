import { readBoolean, readString } from './read.util.js';

const REGULAR_CPF = new Set(['regular', 'ativa', 'ativo', 'apta', 'apt']);
const IRREGULAR_CPF = new Set([
  'irregular',
  'suspensa',
  'cancelada',
  'nula',
  'falecido',
  'pendente',
]);

function inferCpfRegular(status: string | null): boolean | null {
  if (!status) return null;
  const normalized = status.trim().toLowerCase();
  if (REGULAR_CPF.has(normalized)) return true;
  if (IRREGULAR_CPF.has(normalized)) return false;
  if (normalized.includes('regular')) return true;
  if (normalized.includes('irregular') || normalized.includes('suspens')) return false;
  return null;
}

function normalizeCnpjStatus(status: string | null): string | null {
  if (!status) return null;
  const normalized = status.trim().toUpperCase();
  if (normalized.includes('ATIVA')) return 'ATIVA';
  if (normalized.includes('BAIXAD')) return 'BAIXADA';
  if (normalized.includes('INAPTA')) return 'INAPTA';
  if (normalized.includes('SUSPENS')) return 'SUSPENSA';
  return status.trim();
}

const CPF_STATUS_PATH = 'sections.cadastral.cpfStatus';
const CPF_REGULAR_PATH = 'sections.cadastral.cpfRegular';
const CNPJ_STATUS_PATH = 'sections.cadastral.cnpjStatus';

export function normalizeCadastralInMapped(mapped: Record<string, unknown>): void {
  const cpfStatus = readString(mapped[CPF_STATUS_PATH]);
  if (cpfStatus) {
    mapped[CPF_STATUS_PATH] = cpfStatus.toUpperCase();
    if (mapped[CPF_REGULAR_PATH] == null) {
      mapped[CPF_REGULAR_PATH] = inferCpfRegular(cpfStatus);
    }
  }

  const explicitRegular = readBoolean(mapped[CPF_REGULAR_PATH]);
  if (explicitRegular != null) {
    mapped[CPF_REGULAR_PATH] = explicitRegular;
  }

  const cnpjStatus = readString(mapped[CNPJ_STATUS_PATH]);
  if (cnpjStatus) {
    mapped[CNPJ_STATUS_PATH] = normalizeCnpjStatus(cnpjStatus);
  }
}
