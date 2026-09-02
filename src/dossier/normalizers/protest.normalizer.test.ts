import { describe, expect, it } from 'vitest';
import { normalizeProtestList } from './protest.normalizer.js';

describe('protest.normalizer', () => {
  it('maps Lemit protestos to canonical Protest', () => {
    const protests = normalizeProtestList([
      {
        cartorio: '1º Tabelionato',
        valor: 1500,
        data: '2024-01-10',
        cidade: 'São Paulo',
        uf: 'SP',
      },
    ]);

    expect(protests[0]).toMatchObject({
      amount: 1500,
      status: 'ativo',
      date: '2024-01-10',
      registry: '1º Tabelionato',
      city: 'São Paulo',
      state: 'SP',
    });
  });
});
