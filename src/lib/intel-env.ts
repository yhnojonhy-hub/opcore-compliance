import { env } from './env.js';

export interface IntelEnv {
  PORTAL_TRANSPARENCIA_TOKEN: string;
  DATAJUD_API_KEY: string;
  DATAJUD_TRIBUNAIS: string;
  DATAJUD_TRIBUNAIS_DEEP: string;
  DATAJUD_REQUEST_TIMEOUT_MS: number;
  HUNTER_API_KEY: string;
  VERIPHONE_API_KEY: string;
  OPENSANCTIONS_API_KEY: string;
  APIFY_API_TOKEN: string;
  INTERPOL_API_BASE: string;
  PAID_PROVIDERS_ENABLED: string;
  INTEL_SYNC_TIMEOUT_MS: number;
  INTEL_ASYNC_TIMEOUT_MS: number;
}

let cached: IntelEnv | null = null;

export function getEnv(): IntelEnv {
  if (cached) return cached;
  cached = {
    PORTAL_TRANSPARENCIA_TOKEN: process.env.PORTAL_TRANSPARENCIA_TOKEN?.trim() ?? '',
    DATAJUD_API_KEY: process.env.DATAJUD_API_KEY?.trim() ?? '',
    DATAJUD_TRIBUNAIS: process.env.DATAJUD_TRIBUNAIS?.trim() || 'tjsp,tjrj,tjmg,trt2,trf3',
    DATAJUD_TRIBUNAIS_DEEP:
      process.env.DATAJUD_TRIBUNAIS_DEEP?.trim() ||
      'tjsp,tjrj,tjmg,tjrs,tjsc,tjpr,tjba,tjce,tjpe,tjdft,trf1,trf2,trf3,trf4,trf5,trf6,trt1,trt2,trt3,trt15,tst,stj',
    DATAJUD_REQUEST_TIMEOUT_MS: Number(process.env.DATAJUD_REQUEST_TIMEOUT_MS ?? 90_000),
    HUNTER_API_KEY: process.env.HUNTER_API_KEY?.trim() ?? '',
    VERIPHONE_API_KEY: process.env.VERIPHONE_API_KEY?.trim() ?? '',
    OPENSANCTIONS_API_KEY: process.env.OPENSANCTIONS_API_KEY?.trim() ?? '',
    APIFY_API_TOKEN: process.env.APIFY_API_TOKEN?.trim() ?? '',
    INTERPOL_API_BASE:
      process.env.INTERPOL_API_BASE?.trim() || 'https://ws-public.interpol.int/notices/v1',
    PAID_PROVIDERS_ENABLED: process.env.PAID_PROVIDERS_ENABLED?.trim() ?? '',
    INTEL_SYNC_TIMEOUT_MS: Number(process.env.INTEL_SYNC_TIMEOUT_MS ?? 14_000),
    INTEL_ASYNC_TIMEOUT_MS: Number(process.env.INTEL_ASYNC_TIMEOUT_MS ?? 40_000),
  };
  return cached;
}

export function resetIntelEnvCache(): void {
  cached = null;
}

/** Re-export base env for bureau bridge */
export { env };
