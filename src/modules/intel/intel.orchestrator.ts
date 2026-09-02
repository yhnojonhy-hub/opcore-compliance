import type { Prisma } from '@prisma/client';
import type {
  FindingCategory,
  SourceReliability,
  TargetType,
} from '../../contracts/enums/intel.enums.js';
import { getEnv } from '../../lib/intel-env.js';
import { providersFor, slugForProvider } from '../../providers/adapters/registry.js';
import type {
  DossierProvider,
  ProviderContext,
  ProviderFinding,
} from '../../providers/adapters/types.js';
import { isNegativeFinding } from '../../intel/brief.js';
import { markCrossValidated, scoreDossier } from '../../intel/scoring.js';
import { prisma } from '../../db/prisma.js';

const STUB_NAMES = new Set(['TSE candidaturas', 'BNMP 3.0', 'DOU', 'Bigdata Corp', 'Jusbrasil']);
const BUREAU_SOURCE_RE = /bigdatacorp|lemit|brasil\s*api/i;

function isActiveProvider(provider: DossierProvider): boolean {
  if (STUB_NAMES.has(provider.name)) return false;
  if (provider.reliability === 'PAID') return false;
  return true;
}

function lawsuitCaseKey(finding: Pick<ProviderFinding, 'title' | 'details'>): string {
  const details =
    finding.details && typeof finding.details === 'object' && !Array.isArray(finding.details)
      ? (finding.details as Record<string, unknown>)
      : {};
  const raw =
    details.caseNumber ??
    details.numeroProcesso ??
    details.processNumber ??
    details.numero ??
    finding.title;
  const digits = String(raw ?? '').replace(/\D/g, '');
  return (
    digits ||
    String(raw ?? '')
      .trim()
      .toLowerCase()
  );
}

function filterComplementaryFindings(
  findings: ProviderFinding[],
  existing: Array<{
    category: string;
    title: string;
    summary: string;
    sourceName: string;
    details: unknown;
  }>,
): ProviderFinding[] {
  const bureauCategories = new Set(
    existing
      .filter((item) => BUREAU_SOURCE_RE.test(item.sourceName))
      .filter((item) => !isNegativeFinding(`${item.title} ${item.summary}`))
      .map((item) => item.category),
  );

  const existingCases = new Set(
    existing
      .filter((item) => item.category === 'LAWSUIT')
      .map((item) =>
        lawsuitCaseKey({
          title: item.title,
          details:
            item.details && typeof item.details === 'object' && !Array.isArray(item.details)
              ? (item.details as Record<string, unknown>)
              : {},
        }),
      )
      .filter(Boolean),
  );

  return findings.filter((finding) => {
    const text = `${finding.title} ${finding.summary}`;
    if (isNegativeFinding(text) && bureauCategories.has(finding.category)) {
      return false;
    }
    if (finding.category === 'LAWSUIT') {
      const key = lawsuitCaseKey(finding);
      if (key && existingCases.has(key)) return false;
      if (key) existingCases.add(key);
    }
    return true;
  });
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error('timeout')), ms);
    }),
  ]);
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > 180_000) return { truncated: true, bytes: serialized.length };
    return JSON.parse(serialized) as Prisma.InputJsonValue;
  } catch {
    return undefined;
  }
}

function collectAliases(
  target: string,
  targetType: string,
  partyName: string | undefined,
  findings: Array<{ category: string; title: string; details: unknown }>,
): string[] {
  const names = new Set<string>();
  const add = (value?: string) => {
    const text = value?.trim();
    if (text && text.length > 3 && text !== target) names.add(text);
  };
  add(partyName);
  if (targetType === 'NAME') add(target);
  for (const finding of findings) {
    if (finding.category === 'IDENTITY') add(finding.title);
    const details =
      finding.details && typeof finding.details === 'object' && !Array.isArray(finding.details)
        ? (finding.details as Record<string, unknown>)
        : {};
    add(String(details.razao_social ?? ''));
    add(String(details.nome ?? ''));
    add(String(details.nome_fantasia ?? ''));
    add(String(details.razaoSocial ?? ''));
  }
  return [...names].slice(0, 8);
}

async function persistProvider(
  dossierId: string,
  provider: DossierProvider,
  ctx: ProviderContext,
  timeoutMs: number,
): Promise<void> {
  const started = Date.now();
  try {
    const result = await withTimeout(provider.run(ctx), timeoutMs);
    await prisma.intelDossierSource.create({
      data: {
        dossierId,
        name: provider.name,
        providerSlug: slugForProvider(provider.name),
        category: provider.category as FindingCategory,
        reliability: provider.reliability as SourceReliability,
        status: result.status,
        httpStatus: result.httpStatus,
        durationMs: Date.now() - started,
        error: result.error,
        rawPayload: toJson(result.rawPayload),
      },
    });
    if (result.findings.length === 0) return;
    const existing = await prisma.intelDossierFinding.findMany({
      where: { dossierId },
      select: {
        category: true,
        title: true,
        summary: true,
        sourceName: true,
        details: true,
      },
    });
    const complementary = filterComplementaryFindings(result.findings, existing);
    if (complementary.length === 0) return;
    const verified = markCrossValidated(complementary);
    await prisma.intelDossierFinding.createMany({
      data: verified.map((finding) => ({
        dossierId,
        category: finding.category as FindingCategory,
        sourceName: provider.name,
        reliability: provider.reliability as SourceReliability,
        confidence: finding.confidence,
        title: finding.title,
        summary: finding.summary,
        details: (toJson(finding.details) ?? {}) as Prisma.InputJsonValue,
        url: finding.url,
        occurredAt: finding.occurredAt,
        verified: finding.verified,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'erro desconhecido';
    const timedOut = /timeout|abort/i.test(message);
    await prisma.intelDossierSource.create({
      data: {
        dossierId,
        name: provider.name,
        providerSlug: slugForProvider(provider.name),
        category: provider.category as FindingCategory,
        reliability: provider.reliability as SourceReliability,
        status: timedOut ? 'skipped' : 'error',
        durationMs: Date.now() - started,
        error: timedOut ? 'Fonte não respondeu a tempo' : message,
      },
    });
  }
}

async function markCrossSource(dossierId: string): Promise<void> {
  const findings = await prisma.intelDossierFinding.findMany({ where: { dossierId } });
  const groups = new Map<string, string[]>();
  for (const finding of findings) {
    const key = finding.title.replace(/\s+/g, ' ').trim().toLowerCase();
    if (key.length < 5) continue;
    const ids = groups.get(key) ?? [];
    ids.push(finding.id);
    groups.set(key, ids);
  }
  const verifiedIds = [...groups.values()].filter((ids) => ids.length > 1).flat();
  if (verifiedIds.length === 0) return;
  await prisma.intelDossierFinding.updateMany({
    where: { id: { in: verifiedIds } },
    data: { verified: true },
  });
}

async function buildContext(
  dossierId: string,
  deepSearch: boolean,
  paidProviders: string[],
  partyNameHint?: string,
): Promise<ProviderContext | null> {
  const dossier = await prisma.intelDossier.findUnique({
    where: { id: dossierId },
    include: {
      findings: { select: { category: true, title: true, summary: true, details: true } },
    },
  });
  if (!dossier) return null;
  const priorFindings = dossier.findings.map((finding: (typeof dossier.findings)[number]) => ({
    category: finding.category as FindingCategory,
    title: finding.title,
    summary: finding.summary,
    details:
      finding.details && typeof finding.details === 'object' && !Array.isArray(finding.details)
        ? (finding.details as Record<string, unknown>)
        : {},
  }));
  const hint = dossier.partyName ?? partyNameHint;
  const aliases = collectAliases(
    dossier.target,
    dossier.targetType,
    hint ?? undefined,
    dossier.findings,
  );
  return {
    target: dossier.target,
    targetType: dossier.targetType as TargetType,
    partyName: hint ?? aliases[0],
    aliases,
    deepSearch,
    paidProviders,
    priorFindings,
  };
}

async function runPhase(
  dossierId: string,
  phase: 'sync' | 'async',
  deepSearch: boolean,
  paidProviders: string[],
  partyNameHint?: string,
): Promise<void> {
  const env = getEnv();
  const timeoutMs = phase === 'sync' ? env.INTEL_SYNC_TIMEOUT_MS : env.INTEL_ASYNC_TIMEOUT_MS;
  const ctx = await buildContext(dossierId, deepSearch, paidProviders, partyNameHint);
  if (!ctx) return;
  const providers = providersFor(ctx, phase).filter(isActiveProvider);
  if (phase === 'sync') {
    await Promise.allSettled(
      providers.map((provider) => persistProvider(dossierId, provider, ctx, timeoutMs)),
    );
  } else {
    for (const provider of providers) {
      const freshCtx =
        (await buildContext(dossierId, deepSearch, paidProviders, partyNameHint)) ?? ctx;
      await persistProvider(dossierId, provider, freshCtx, timeoutMs);
      if (provider.rateMs) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(provider.rateMs, 400)));
      }
    }
  }
  await markCrossSource(dossierId);
}

export async function runIntelSearch(input: {
  dossierId: string;
  deepSearch: boolean;
  paidProviders?: string[];
  partyNameHint?: string;
}): Promise<void> {
  const paidProviders = input.paidProviders ?? [];
  try {
    await runPhase(input.dossierId, 'sync', input.deepSearch, paidProviders, input.partyNameHint);
    await prisma.intelDossier.update({
      where: { id: input.dossierId },
      data: { status: 'PARTIAL' },
    });
    if (input.deepSearch) {
      await runPhase(input.dossierId, 'async', true, paidProviders, input.partyNameHint);
    }
    const findings = await prisma.intelDossierFinding.findMany({
      where: { dossierId: input.dossierId },
    });
    await prisma.intelDossier.update({
      where: { id: input.dossierId },
      data: {
        status: 'COMPLETED',
        overallScore: scoreDossier(findings),
        completedAt: new Date(),
      },
    });
  } catch (err) {
    await prisma.intelDossier.update({
      where: { id: input.dossierId },
      data: {
        status: 'FAILED',
        error: err instanceof Error ? err.message : 'Falha ao gerar dossiê intel',
      },
    });
    throw err;
  }
}
