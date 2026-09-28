import { describe, expect, it } from 'vitest';
import { cnjCheckDigits, dataJudAliasesForCnj, parseCnj } from './cnj.js';

describe('parseCnj', () => {
  it('aceita número formatado com dígito verificador válido', () => {
    const cnj = parseCnj('5003495-02.2026.8.24.0037');
    expect(cnj).toMatchObject({
      digits: '50034950220268240037',
      formatted: '5003495-02.2026.8.24.0037',
      segment: '8',
      jtr: '824',
    });
  });

  it('recusa dígito verificador errado ou tamanho inválido', () => {
    expect(parseCnj('5003495-03.2026.8.24.0037')).toBeNull();
    expect(parseCnj('123')).toBeNull();
  });

  it('calcula o dígito verificador', () => {
    expect(cnjCheckDigits('50034950020268240037')).toBe('02');
  });
});

describe('dataJudAliasesForCnj', () => {
  const build = (jtr: string) => {
    const base = `0000001xx2024${jtr}0001`;
    const digits = base.replace('xx', cnjCheckDigits(base.replace('xx', '00')));
    const cnj = parseCnj(digits);
    if (!cnj) throw new Error('fixture inválida');
    return cnj;
  };

  it('estadual vai para o TJ e depois STJ', () => {
    expect(dataJudAliasesForCnj(build('824'))).toEqual(['tjsc', 'stj']);
    expect(dataJudAliasesForCnj(build('807'))).toEqual(['tjdft', 'stj']);
  });

  it('federal usa o segmento 4', () => {
    expect(dataJudAliasesForCnj(build('403'))).toEqual(['trf3', 'stj']);
  });

  it('trabalho vai para o TRT e depois TST', () => {
    expect(dataJudAliasesForCnj(build('502'))).toEqual(['trt2', 'tst']);
  });

  it('eleitoral usa a ordem das UFs', () => {
    expect(dataJudAliasesForCnj(build('626'))).toEqual(['tre-sp', 'tse']);
  });
});
