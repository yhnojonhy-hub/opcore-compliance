import { asRecord, fetchJson } from '../providers/adapters/http.util.js';
import { estimateBdcMonth, type BdcMonthEstimate, type BillingVendor } from './prices.js';
import { countUsageBySlug, startOfMonth, sumCredits } from './usage-ledger.js';

export type ProviderBillingStatus =
  | 'ok'
  | 'low_balance'
  | 'payment_issue'
  | 'ip_blocked'
  | 'unauthorized'
  | 'not_configured'
  | 'no_api'
  | 'error';

export interface ApolloRateUsage {
  endpoint: string;
  window: 'minute' | 'hour' | 'day';
  limit: number | null;
  consumed: number | null;
  leftOver: number | null;
}

export interface ProviderBillingCard {
  vendor: BillingVendor;
  name: string;
  status: ProviderBillingStatus;
  statusMessage: string | null;
  checkedAt: string;
  billingModel: string;
  portalUrl: string;
  howToPay: string[];
  monthUsage: { requests: number; credits: number | null };
  lemit?: { saldo: number | null; consumo: number | null };
  apollo?: { rateLimits: ApolloRateUsage[] };
  bigdatacorp?: BdcMonthEstimate;
}

export interface ProviderBillingOverview {
  generatedAt: string;
  monthStart: string;
  providers: ProviderBillingCard[];
}

type FetchJson = typeof fetchJson;

const LEMIT_BASE = 'https://api.lemit.com.br/api/v1';
const APOLLO_BASE = 'https://api.apollo.io/api/v1';
const TIMEOUT_MS = 10_000;

function lemitLowBalanceThreshold(): number {
  const value = Number(process.env.BILLING_LEMIT_LOW_BALANCE ?? 50);
  return Number.isFinite(value) ? value : 50;
}

function upstreamMessage(json: unknown, text: string): string {
  const obj = asRecord(json);
  if (Array.isArray(obj.errors)) return obj.errors.map(String).join('; ');
  if (typeof obj.error === 'string') return obj.error;
  if (typeof obj.message === 'string') return obj.message;
  return text.slice(0, 200);
}

function toNumber(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

export async function getLemitCard(
  monthStart: Date,
  fetcher: FetchJson = fetchJson,
): Promise<ProviderBillingCard> {
  const card: ProviderBillingCard = {
    vendor: 'lemit',
    name: 'Lemit',
    status: 'ok',
    statusMessage: null,
    checkedAt: new Date().toISOString(),
    billingModel: 'Créditos pré-pagos (0,12 crédito por consulta pessoa/empresa)',
    portalUrl: 'https://lemitti.com/',
    howToPay: [
      'Recarga de créditos solicitada ao comercial da Lemit (boleto ou PIX enviado por e-mail).',
      'Saldo consultável via API apenas a partir do IP liberado (servidor de produção).',
    ],
    monthUsage: {
      requests: Object.values(await countUsageBySlug('lemit', monthStart)).reduce(
        (a, b) => a + b,
        0,
      ),
      credits: await sumCredits('lemit', monthStart),
    },
    lemit: { saldo: null, consumo: null },
  };

  const token = process.env.LEMIT_API_TOKEN?.trim();
  if (!token) {
    card.status = 'not_configured';
    card.statusMessage = 'LEMIT_API_TOKEN não configurado';
    return card;
  }

  const result = await fetcher(
    `${LEMIT_BASE}/saldo`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
    TIMEOUT_MS,
  );
  const json = asRecord(result.json);
  const saldo = toNumber(json.saldo);

  if (result.ok && saldo !== null) {
    card.lemit = { saldo, consumo: toNumber(json.consumo) };
    if (saldo < lemitLowBalanceThreshold()) {
      card.status = 'low_balance';
      card.statusMessage = `Saldo abaixo de ${lemitLowBalanceThreshold()} créditos`;
    }
    return card;
  }

  const message = upstreamMessage(result.json, result.text);
  if (/fora do local permitido/i.test(message)) card.status = 'ip_blocked';
  else if (result.status === 401 || /n[aã]o autorizado|unauthorized/i.test(message))
    card.status = 'unauthorized';
  else card.status = 'error';
  card.statusMessage = message || `HTTP ${result.status}`;
  return card;
}

export function parseApolloRateLimits(json: unknown): ApolloRateUsage[] {
  const rows: ApolloRateUsage[] = [];
  for (const [endpoint, value] of Object.entries(asRecord(json))) {
    const windows = asRecord(value);
    for (const window of ['minute', 'hour', 'day'] as const) {
      const w = asRecord(windows[window]);
      if (Object.keys(w).length === 0) continue;
      rows.push({
        endpoint,
        window,
        limit: toNumber(w.limit),
        consumed: toNumber(w.consumed),
        leftOver: toNumber(w.left_over),
      });
    }
  }
  return rows;
}

export async function getApolloCard(
  monthStart: Date,
  fetcher: FetchJson = fetchJson,
): Promise<ProviderBillingCard> {
  const card: ProviderBillingCard = {
    vendor: 'apollo',
    name: 'Apollo.io',
    status: 'ok',
    statusMessage: null,
    checkedAt: new Date().toISOString(),
    billingModel: 'Assinatura mensal/anual com créditos de e-mail, telefone e exportação',
    portalUrl: 'https://app.apollo.io/#/settings/plans/billing',
    howToPay: [
      'Cobrança automática no cartão cadastrado em app.apollo.io > Settings > Plans & Billing.',
      'Faturas (invoices) e troca de cartão ficam na mesma tela; não há boleto.',
    ],
    monthUsage: {
      requests: Object.values(await countUsageBySlug('apollo', monthStart)).reduce(
        (a, b) => a + b,
        0,
      ),
      credits: await sumCredits('apollo', monthStart),
    },
    apollo: { rateLimits: [] },
  };

  const apiKey = process.env.APOLLO_API_KEY?.trim();
  if (!apiKey) {
    card.status = 'not_configured';
    card.statusMessage = 'APOLLO_API_KEY não configurado';
    return card;
  }

  const result = await fetcher(
    `${APOLLO_BASE}/usage_stats/api_usage_stats`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'x-api-key': apiKey,
      },
      body: '{}',
    },
    TIMEOUT_MS,
  );

  const message = upstreamMessage(result.json, result.text);
  if (/issue with your payment/i.test(message)) {
    card.status = 'payment_issue';
    card.statusMessage = message;
    return card;
  }
  if (!result.ok) {
    card.status = result.status === 401 || result.status === 403 ? 'unauthorized' : 'error';
    card.statusMessage =
      result.status === 403
        ? 'usage_stats exige master API key da Apollo'
        : message || `HTTP ${result.status}`;
    return card;
  }

  card.apollo = { rateLimits: parseApolloRateLimits(result.json) };
  return card;
}

export async function getBigDataCorpCard(monthStart: Date): Promise<ProviderBillingCard> {
  const estimate = estimateBdcMonth(await countUsageBySlug('bigdatacorp', monthStart));
  return {
    vendor: 'bigdatacorp',
    name: 'BigDataCorp',
    status: 'no_api',
    statusMessage: 'Sem API de consumo/faturas: valores estimados pelo ledger local',
    checkedAt: new Date().toISOString(),
    billingModel: 'Pós-pago mensal por consulta de dataset (preço público com desconto por volume)',
    portalUrl: 'https://center.bigdatacorp.com.br/',
    howToPay: [
      'Dia 1 de cada mês: relatório de consumo e, em seguida, fatura + boleto enviados ao e-mail do responsável financeiro.',
      'BDC Center > Financeiro: faturas, parcelas, boletos e notas fiscais (requer usuário administrador do domínio).',
      'Fatura em aberto por mais de 30 dias pode suspender a conta e todos os tokens.',
    ],
    monthUsage: { requests: estimate.requests, credits: null },
    bigdatacorp: estimate,
  };
}

export async function getProviderBillingOverview(
  fetcher: FetchJson = fetchJson,
  now = new Date(),
): Promise<ProviderBillingOverview> {
  const monthStart = startOfMonth(now);
  const providers = await Promise.all([
    getBigDataCorpCard(monthStart),
    getLemitCard(monthStart, fetcher),
    getApolloCard(monthStart, fetcher),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    monthStart: monthStart.toISOString(),
    providers,
  };
}
