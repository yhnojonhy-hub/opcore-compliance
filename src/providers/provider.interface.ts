export interface FieldMapping {
  source: string;
  target: string;
}

export interface BdcProviderMeta {
  category?: string;
  activationTier?: number;
  dataset?: string;
  schemaBlocks?: string[];
}

export interface RequestTemplate {
  path?: string;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  fixtureKey?: string;
  _bdcMeta?: BdcProviderMeta;
}

export interface ProviderConfig {
  slug: string;
  name: string;
  baseUrl: string;
  httpMethod: string;
  requestTemplate: RequestTemplate;
  authType: string;
  authConfigRef?: string | null;
  fieldMappings: FieldMapping[];
  supportedTypes: string[];
  isActive: boolean;
  priority: number;
}

export interface ConsultContext {
  document: string;
  documentType: 'CPF' | 'CNPJ';
}
