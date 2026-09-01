export class ProviderHttpError extends Error {
  constructor(
    message: string,
    readonly providerSlug: string,
    readonly upstreamStatus: number,
    readonly upstreamBody?: string,
  ) {
    super(message);
    this.name = 'ProviderHttpError';
  }
}
