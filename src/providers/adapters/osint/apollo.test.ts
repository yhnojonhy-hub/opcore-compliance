import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetIntelEnvCache } from '../../../lib/intel-env.js';
import {
  apollo,
  collectApolloSeeds,
  mapApolloPerson,
} from './apollo.js';
import type { ProviderContext } from '../types.js';

const fixture = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../__fixtures__/osint-apollo-io-response.json'),
    'utf-8',
  ),
) as {
  peopleMatch: { person: Record<string, unknown> };
  organizationsEnrich: { organization: Record<string, unknown> };
};

describe('collectApolloSeeds', () => {
  it('collects partyName, QSA and emails from prior findings', () => {
    const ctx: Pick<
      ProviderContext,
      'target' | 'targetType' | 'partyName' | 'aliases' | 'priorFindings'
    > = {
      target: '58426534000164',
      targetType: 'CNPJ',
      partyName: 'INDEX CORE',
      aliases: ['Index Core Ltda'],
      priorFindings: [
        {
          category: 'IDENTITY',
          title: 'Quadro societário',
          summary: 'sócios',
          details: {
            qsa: [{ name: 'Maria Silva' }, { nome: 'João Souza' }],
            emails: [{ email: 'contato@indexcore.com.br' }],
          },
        },
      ],
    };

    const seeds = collectApolloSeeds(ctx, { organizationName: 'INDEX CORE', max: 8 });
    expect(seeds.some((s) => s.name === 'INDEX CORE')).toBe(true);
    expect(seeds.some((s) => s.name === 'Maria Silva')).toBe(true);
    expect(seeds.some((s) => s.email === 'contato@indexcore.com.br')).toBe(true);
    expect(seeds.some((s) => s.domain === 'indexcore.com.br')).toBe(true);
  });

  it('caps seeds at max', () => {
    const ctx: Pick<
      ProviderContext,
      'target' | 'targetType' | 'partyName' | 'aliases' | 'priorFindings'
    > = {
      target: '58426534000164',
      targetType: 'CNPJ',
      partyName: 'Empresa',
      aliases: [],
      priorFindings: [
        {
          category: 'IDENTITY',
          title: 'QSA',
          summary: '',
          details: {
            qsa: Array.from({ length: 20 }, (_, i) => ({ name: `Pessoa ${i} Completa` })),
          },
        },
      ],
    };
    expect(collectApolloSeeds(ctx, { max: 3 })).toHaveLength(3);
  });

  it('returns empty when only document digits are available', () => {
    expect(
      collectApolloSeeds({
        target: '37740937843',
        targetType: 'CPF',
        aliases: [],
        priorFindings: [],
      }),
    ).toEqual([]);
  });
});

describe('mapApolloPerson', () => {
  it('maps fixture person fields', () => {
    const person = mapApolloPerson(fixture.peopleMatch.person);
    expect(person).toMatchObject({
      id: 'apollo-person-1',
      name: 'Maria Silva',
      email: 'maria@indexcore.com.br',
      organizationName: 'INDEX CORE',
      linkedinUrl: 'https://www.linkedin.com/in/mariasilva',
    });
    expect(person?.phone).toBeUndefined();
  });
});

describe('apollo adapter', () => {
  beforeEach(() => {
    resetIntelEnvCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete process.env.APOLLO_API_KEY;
    delete process.env.APOLLO_MAX_MATCHES;
    delete process.env.APOLLO_REVEAL_PHONES;
    resetIntelEnvCache();
  });

  it('skips when APOLLO_API_KEY is missing', async () => {
    delete process.env.APOLLO_API_KEY;
    resetIntelEnvCache();
    const result = await apollo.run({
      target: '58426534000164',
      targetType: 'CNPJ',
      partyName: 'INDEX CORE',
      aliases: [],
      deepSearch: false,
      paidProviders: [],
      priorFindings: [],
    });
    expect(result.status).toBe('skipped');
    expect(result.error).toMatch(/APOLLO_API_KEY/);
  });

  it('skips when there are no useful seeds', async () => {
    process.env.APOLLO_API_KEY = 'test-key';
    resetIntelEnvCache();
    const result = await apollo.run({
      target: '37740937843',
      targetType: 'CPF',
      aliases: [],
      deepSearch: false,
      paidProviders: [],
      priorFindings: [],
    });
    expect(result.status).toBe('skipped');
    expect(result.error).toMatch(/Sem nome\/e-mail/);
  });

  it('maps people/match fixture into IDENTITY and SOCIAL_PRESENCE findings', async () => {
    process.env.APOLLO_API_KEY = 'test-key';
    process.env.APOLLO_MAX_MATCHES = '2';
    process.env.APOLLO_REVEAL_PHONES = 'true';
    resetIntelEnvCache();

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/organizations/enrich')) {
        return new Response(JSON.stringify(fixture.organizationsEnrich), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(fixture.peopleMatch), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const result = await apollo.run({
      target: '58426534000164',
      targetType: 'CNPJ',
      partyName: 'INDEX CORE',
      aliases: [],
      deepSearch: false,
      paidProviders: [],
      priorFindings: [
        {
          category: 'IDENTITY',
          title: 'Contatos',
          summary: '1 e-mail',
          details: { emails: [{ email: 'contato@indexcore.com.br' }] },
        },
      ],
    });

    expect(result.status).toBe('ok');
    expect(result.findings.some((f) => f.category === 'IDENTITY' && f.title === 'Maria Silva')).toBe(
      true,
    );
    expect(result.findings.some((f) => f.category === 'SOCIAL_PRESENCE')).toBe(true);
    expect(fetchMock).toHaveBeenCalled();
    const matchCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes('/people/match'),
    );
    expect(matchCalls.length).toBeLessThanOrEqual(2);
    const matchInit = matchCalls[0]?.[1] as RequestInit | undefined;
    const matchBody = JSON.parse(String(matchInit?.body ?? '{}')) as {
      reveal_phone_number?: boolean;
    };
    expect(matchBody.reveal_phone_number).toBe(false);
    const identity = result.findings.find((f) => f.category === 'IDENTITY' && f.title === 'Maria Silva');
    expect(identity?.details.phones).toBeUndefined();
    expect(identity?.details.phone).toBeUndefined();
  });

  it('emits CHECKED_ABSENT when Apollo returns no person', async () => {
    process.env.APOLLO_API_KEY = 'test-key';
    resetIntelEnvCache();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ person: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await apollo.run({
      target: 'Maria Silva',
      targetType: 'NAME',
      partyName: 'Maria Silva',
      aliases: [],
      deepSearch: false,
      paidProviders: [],
      priorFindings: [],
    });

    expect(result.status).toBe('ok');
    expect(result.findings[0]?.details).toMatchObject({
      consultedAbsent: true,
      status: 'CHECKED_ABSENT',
    });
  });
});
