import {
  CNJ_JTR_TO_ALIAS,
  CNJ_SEGMENT_GROUP,
  DATAJUD_TRIBUNAL_CATALOG,
} from '../providers/adapters/datajud/endpoints.js';

export interface CnjNumber {
  digits: string;
  formatted: string;
  sequential: string;
  checkDigits: string;
  year: string;
  segment: string;
  court: string;
  origin: string;
  jtr: string;
}

export function cnjDigits(value: string): string {
  return value.replace(/\D/g, '');
}

export function formatCnj(digits: string): string {
  return `${digits.slice(0, 7)}-${digits.slice(7, 9)}.${digits.slice(9, 13)}.${digits.slice(13, 14)}.${digits.slice(14, 16)}.${digits.slice(16)}`;
}

function mod97(numeric: string): number {
  let rest = 0;
  for (const char of numeric) rest = (rest * 10 + Number(char)) % 97;
  return rest;
}

/** Dígito verificador (ISO 7064 mod 97-10, Res. CNJ 65/2008). */
export function cnjCheckDigits(digits: string): string {
  const base = `${digits.slice(0, 7)}${digits.slice(9, 20)}00`;
  return String(98 - mod97(base)).padStart(2, '0');
}

export function parseCnj(value: string): CnjNumber | null {
  const digits = cnjDigits(value);
  if (digits.length !== 20) return null;
  if (cnjCheckDigits(digits) !== digits.slice(7, 9)) return null;
  return {
    digits,
    formatted: formatCnj(digits),
    sequential: digits.slice(0, 7),
    checkDigits: digits.slice(7, 9),
    year: digits.slice(9, 13),
    segment: digits.slice(13, 14),
    court: digits.slice(14, 16),
    origin: digits.slice(16, 20),
    jtr: digits.slice(13, 16),
  };
}

/** Tribunal superior que recebe recursos de cada segmento (o número CNJ não muda no recurso). */
const SEGMENT_SUPERIOR: Record<string, string[]> = {
  '4': ['stj'],
  '5': ['tst'],
  '6': ['tse'],
  '8': ['stj'],
  '9': ['stm'],
};

/**
 * Alias DataJud do tribunal de origem e, em seguida, o superior do segmento.
 * Sem mapeamento do tribunal, cai para todos os tribunais do segmento.
 */
export function dataJudAliasesForCnj(cnj: CnjNumber): string[] {
  const primary = CNJ_JTR_TO_ALIAS[cnj.jtr];
  if (!primary) {
    const group = CNJ_SEGMENT_GROUP[cnj.segment];
    return group
      ? DATAJUD_TRIBUNAL_CATALOG.filter((t) => t.group === group).map((t) => t.alias)
      : [];
  }
  return [...new Set([primary, ...(SEGMENT_SUPERIOR[cnj.segment] ?? [])])];
}
