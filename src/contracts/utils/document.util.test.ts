import { describe, expect, it } from 'vitest';
import { isValidCnpj, isValidCpf, normalizeDocument, validateDocument } from './document.util.js';

describe('document.util', () => {
  it('normalizes document digits', () => {
    expect(normalizeDocument('529.982.247-25')).toBe('52998224725');
  });

  it('validates CPF', () => {
    expect(isValidCpf('52998224725')).toBe(true);
    expect(isValidCpf('11111111111')).toBe(false);
  });

  it('validates CNPJ', () => {
    expect(isValidCnpj('11444777000161')).toBe(true);
    expect(isValidCnpj('11111111111111')).toBe(false);
  });

  it('validateDocument returns normalized value', () => {
    expect(validateDocument('529.982.247-25', 'CPF')).toBe('52998224725');
  });
});
