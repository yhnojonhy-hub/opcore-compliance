import type {
  FieldMapping,
  ProviderConfig,
  RequestTemplate,
} from '../../providers/provider.interface.js';

export type { FieldMapping, ProviderConfig, RequestTemplate };

export interface ProviderRecord extends ProviderConfig {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}
