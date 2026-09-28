import type { DocumentType, Prisma } from '@prisma/client';
import type {
  Lawsuit,
  LawsuitDetail,
  LawsuitInstance,
  LawsuitSourceReport,
} from '../../contracts/types/canonical/index.js';
import { digitsOnly, isValidCnpj, isValidCpf } from '../../contracts/utils/document.util.js';
import { prisma } from '../../db/prisma.js';
import { type CnjNumber, cnjDigits, parseCnj } from '../../lib/cnj.js';
import { env } from '../../lib/env.js';
import {
  type DataJudByNumberResult,
  searchDataJudByNumber,
} from '../../providers/adapters/datajud/by-number.js';
import { consultAllForDocument } from '../compliance/compliance.orchestrator.js';
import { assembleDossierFromCache } from '../compliance/dossier.service.js';
import { buildSliceEnvelope } from '../compliance/dossier.slices.js';

export class InvalidCnjError extends Error {
  constructor(value: string) {
    super(`Número de processo inválido: ${value}. Informe o número CNJ completo (20 dígitos).`);
    this.name = 'InvalidCnjError';
  }
}

export interface LawsuitLookupDocument {
  document: string;
  documentType: DocumentType;
}

export interface LawsuitLookupInput {
  number: string;
  documents?: LawsuitLookupDocument[];
  forceRefresh?: boolean;
  requestedBy?: string;
}

interface CachedPayload {
  detail: LawsuitDetail;
  documents: string[];
}

export interface LawsuitLookupDeps {
  searchDataJud?: (cnj: CnjNumber) => Promise<DataJudByNumberResult>;
  lawsuitsByDocument?: (doc: LawsuitLookupDocument, forceRefresh: boolean) => Promise<Lawsuit[]>;
  readCache?: (number: string) => Promise<{ payload: unknown; expiresAt: Date } | null>;
  writeCache?: (number: string, payload: CachedPayload, found: boolean) => Promise<void>;
  now?: () => Date;
}

/** Only the paid datasets that return lawsuits; the full catalog would bill every dataset per document. */
export const LAWSUIT_PROVIDER_SLUGS = [
  'bigdatacorp-pf-processes',
  'bigdatacorp-pj-processes',
  'bigdatacorp-pj-owners_lawsuits',
];

async function defaultLawsuitsByDocument(
  doc: LawsuitLookupDocument,
  forceRefresh: boolean,
): Promise<Lawsuit[]> {
  const results = await consultAllForDocument({
    document: doc.document,
    documentType: doc.documentType,
    slugAllowList: LAWSUIT_PROVIDER_SLUGS,
    maxTier: 3,
    softFail: true,
    forceRefresh,
  });
  if (results.length === 0) throw new Error('bureaus de processos indisponíveis');
  const { dossier } = await assembleDossierFromCache({
    document: doc.document,
    documentType: doc.documentType,
    persist: false,
  });
  const data = buildSliceEnvelope(dossier, 'lawsuits').data as { lawsuits?: Lawsuit[] };
  return data.lawsuits ?? [];
}

async function defaultReadCache(number: string) {
  return prisma.lawsuitLookup.findUnique({
    where: { number },
    select: { payload: true, expiresAt: true },
  });
}

async function defaultWriteCache(number: string, payload: CachedPayload, found: boolean) {
  const expiresAt = new Date(Date.now() + env.lawsuitLookupTtlHours * 3_600_000);
  const json = payload as unknown as Prisma.InputJsonValue;
  await prisma.lawsuitLookup.upsert({
    where: { number },
    create: { number, payload: json, found, expiresAt },
    update: { payload: json, found, expiresAt },
  });
}

/** CPF/CNPJ válidos, sem repetição. */
export function normalizeLookupDocuments(docs: LawsuitLookupDocument[] = []) {
  const seen = new Set<string>();
  const out: LawsuitLookupDocument[] = [];
  for (const doc of docs) {
    const document = digitsOnly(doc.document);
    const valid = doc.documentType === 'CPF' ? isValidCpf(document) : isValidCnpj(document);
    if (!valid || seen.has(document)) continue;
    seen.add(document);
    out.push({ document, documentType: doc.documentType });
  }
  return out;
}

function maskDocument(doc: LawsuitLookupDocument): string {
  const d = doc.document;
  return doc.documentType === 'CPF'
    ? `CPF ***.${d.slice(3, 6)}.***-**`
    : `CNPJ ${d.slice(0, 8)}/****`;
}

function pickLatest(instances: LawsuitInstance[]): LawsuitInstance | null {
  if (instances.length === 0) return null;
  return [...instances].sort((a, b) =>
    (b.updatedAt ?? b.filedAt ?? '').localeCompare(a.updatedAt ?? a.filedAt ?? ''),
  )[0];
}

function earliest(values: Array<string | null | undefined>): string | null {
  const list = values.filter((v): v is string => Boolean(v)).sort();
  return list[0] ?? null;
}

export function mergeLawsuitDetail(params: {
  cnj: CnjNumber;
  dataJud: DataJudByNumberResult;
  documentMatches: Lawsuit[];
  sources: LawsuitSourceReport[];
  now: Date;
}): LawsuitDetail {
  const { cnj, dataJud, documentMatches, sources, now } = params;
  const instances: LawsuitInstance[] =
    dataJud.status === 'ok'
      ? dataJud.instances.map((i) => ({
          tribunal: dataJud.tribunal ?? i.alias.toUpperCase(),
          degree: i.degree,
          organ: i.organ,
          className: i.className,
          subjects: i.subjects,
          filedAt: i.filedAt,
          updatedAt: i.updatedAt,
          system: i.system,
        }))
      : [];
  const current = pickLatest(instances);
  const movements = dataJud.status === 'ok' ? dataJud.movements : [];
  const bureau = documentMatches.find((l) => l.status) ?? documentMatches[0];
  const amount = documentMatches.find((l) => l.amount != null)?.amount ?? null;
  const subjects = [...new Set(instances.flatMap((i) => i.subjects))];
  const lastMovementAt = movements[0]?.date ?? null;
  const lastUpdateAt =
    [lastMovementAt, current?.updatedAt ?? null]
      .filter((v): v is string => Boolean(v))
      .sort()
      .pop() ?? null;

  return {
    number: cnj.digits,
    formattedNumber: cnj.formatted,
    found: instances.length > 0 || documentMatches.length > 0,
    tribunal: (dataJud.status === 'ok' ? dataJud.tribunal : null) ?? bureau?.court ?? null,
    court: bureau?.court ?? (dataJud.status === 'ok' ? dataJud.tribunal : null),
    className: instances.find((i) => i.degree === 'G1')?.className ?? current?.className ?? null,
    subjects,
    organ: current?.organ ?? null,
    degree: current?.degree ?? null,
    filedAt: earliest([
      ...instances.map((i) => i.filedAt),
      ...documentMatches.map((l) => l.filedAt),
    ]),
    lastUpdateAt,
    status: bureau?.status ?? null,
    type: bureau?.type ?? current?.className ?? null,
    amount,
    instances,
    movements,
    sources,
    fetchedAt: now.toISOString(),
    cached: false,
  };
}

function dataJudReport(result: DataJudByNumberResult): LawsuitSourceReport {
  switch (result.status) {
    case 'ok':
      return {
        name: 'DataJud CNJ',
        status: 'ok',
        detail: `${result.alias.toUpperCase()}: ${result.movements.length} movimentação(ões)`,
      };
    case 'not_found':
      return {
        name: 'DataJud CNJ',
        status: 'not_found',
        detail: `Não encontrado em ${result.triedAliases.map((a) => a.toUpperCase()).join(', ')}`,
      };
    case 'skipped':
      return { name: 'DataJud CNJ', status: 'skipped', error: result.error };
    default:
      return { name: 'DataJud CNJ', status: 'error', error: result.error };
  }
}

async function lookupByDocuments(
  cnj: CnjNumber,
  documents: LawsuitLookupDocument[],
  forceRefresh: boolean,
  fetchLawsuits: NonNullable<LawsuitLookupDeps['lawsuitsByDocument']>,
) {
  const matches: Lawsuit[] = [];
  const reports: LawsuitSourceReport[] = [];
  if (documents.length === 0) {
    reports.push({
      name: 'Bureaus OpCore',
      status: 'skipped',
      error: 'nenhuma parte com CPF/CNPJ válido para consulta',
    });
    return { matches, reports };
  }

  const results = await Promise.all(
    documents.map(async (doc) => {
      try {
        return { doc, lawsuits: await fetchLawsuits(doc, forceRefresh) };
      } catch (error) {
        return { doc, error: error instanceof Error ? error.message : String(error) };
      }
    }),
  );

  for (const result of results) {
    const name = `Bureaus OpCore (${maskDocument(result.doc)})`;
    if ('error' in result) {
      reports.push({ name, status: 'error', error: result.error });
      continue;
    }
    const found = result.lawsuits.filter(
      (l) => l.caseNumber && cnjDigits(l.caseNumber) === cnj.digits,
    );
    matches.push(...found);
    const providers = [...new Set(found.map((l) => l.source).filter(Boolean))];
    reports.push(
      found.length > 0
        ? {
            name,
            status: 'ok',
            detail: providers.length ? `Fontes: ${providers.join(', ')}` : undefined,
          }
        : {
            name,
            status: 'not_found',
            detail: `${result.lawsuits.length} processo(s) do documento, nenhum com este número`,
          },
    );
  }
  return { matches, reports };
}

export async function lookupLawsuit(
  input: LawsuitLookupInput,
  deps: LawsuitLookupDeps = {},
): Promise<LawsuitDetail> {
  const cnj = parseCnj(input.number);
  if (!cnj) throw new InvalidCnjError(input.number);

  const now = deps.now ?? (() => new Date());
  const readCache = deps.readCache ?? defaultReadCache;
  const writeCache = deps.writeCache ?? defaultWriteCache;
  const documents = normalizeLookupDocuments(input.documents);
  const forceRefresh = Boolean(input.forceRefresh);

  if (!forceRefresh) {
    const cached = await readCache(cnj.digits);
    const payload = cached?.payload as CachedPayload | undefined;
    if (
      cached &&
      payload?.detail &&
      cached.expiresAt > now() &&
      documents.every((d) => payload.documents?.includes(d.document))
    ) {
      return { ...payload.detail, cached: true };
    }
  }

  const [dataJud, byDocument] = await Promise.all([
    (deps.searchDataJud ?? searchDataJudByNumber)(cnj),
    // Bureaus pagos mantêm o cache próprio de 30 dias; forceRefresh só renova esta consulta.
    lookupByDocuments(cnj, documents, false, deps.lawsuitsByDocument ?? defaultLawsuitsByDocument),
  ]);

  const detail = mergeLawsuitDetail({
    cnj,
    dataJud,
    documentMatches: byDocument.matches,
    sources: [dataJudReport(dataJud), ...byDocument.reports],
    now: now(),
  });

  const allFailed = detail.sources.every((s) => s.status === 'error' || s.status === 'skipped');
  if (!allFailed) {
    await writeCache(
      cnj.digits,
      { detail, documents: documents.map((d) => d.document) },
      detail.found,
    );
  }
  return detail;
}
