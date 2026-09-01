import { z } from 'zod';

const fieldMappingSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
});

const requestTemplateSchema = z.object({
  path: z.string().optional(),
  query: z.record(z.string()).optional(),
  body: z.record(z.unknown()).optional(),
  headers: z.record(z.string()).optional(),
  fixtureKey: z.string().optional(),
});

export const providerConfigSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  baseUrl: z.string().min(1),
  httpMethod: z.string().min(1),
  requestTemplate: requestTemplateSchema,
  authType: z.enum(['none', 'bearer', 'api_key_header', 'mock']),
  authConfigRef: z.string().nullable().optional(),
  fieldMappings: z.array(fieldMappingSchema),
  supportedTypes: z.array(z.enum(['CPF', 'CNPJ'])).min(1),
  isActive: z.boolean(),
  priority: z.number().int(),
});

export type ProviderConfigInput = z.infer<typeof providerConfigSchema>;
