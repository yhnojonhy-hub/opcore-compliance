import type { DocumentType } from '@prisma/client';

export function normalizeDocument(raw: string): string {
  return raw.replace(/\D/g, '');
}

function calcCpfDigit(digits: number[], factor: number): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    sum += digits[i] * factor--;
  }
  const mod = (sum * 10) % 11;
  return mod === 10 ? 0 : mod;
}

export function isValidCpf(cpf: string): boolean {
  const d = normalizeDocument(cpf);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const nums = d.split('').map(Number);
  const d1 = calcCpfDigit(nums.slice(0, 9), 10);
  const d2 = calcCpfDigit(nums.slice(0, 10), 11);
  return d1 === nums[9] && d2 === nums[10];
}

function calcCnpjDigit(digits: number[], weights: number[]): number {
  const sum = digits.reduce((acc, n, i) => acc + n * weights[i], 0);
  const mod = sum % 11;
  return mod < 2 ? 0 : 11 - mod;
}

export function isValidCnpj(cnpj: string): boolean {
  const d = normalizeDocument(cnpj);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const nums = d.split('').map(Number);
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const d1 = calcCnpjDigit(nums.slice(0, 12), w1);
  const d2 = calcCnpjDigit(nums.slice(0, 13), w2);
  return d1 === nums[12] && d2 === nums[13];
}

export function detectDocumentType(document: string): DocumentType {
  const d = normalizeDocument(document);
  if (d.length === 11) return 'CPF';
  if (d.length === 14) return 'CNPJ';
  throw new Error('Documento inválido: deve ser CPF (11) ou CNPJ (14) dígitos');
}

export function validateDocument(document: string, documentType: DocumentType): string {
  const normalized = normalizeDocument(document);
  if (documentType === 'CPF' && !isValidCpf(normalized)) {
    throw new Error('CPF inválido');
  }
  if (documentType === 'CNPJ' && !isValidCnpj(normalized)) {
    throw new Error('CNPJ inválido');
  }
  return normalized;
}
