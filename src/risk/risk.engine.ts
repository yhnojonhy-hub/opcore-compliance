import type { DocumentType, RiskRule } from '@prisma/client';
import { ComplianceStatus } from '../contracts/enums/compliance-status.enum.js';
import { RiskLevel } from '../contracts/enums/risk-level.enum.js';
import type {
  ComplianceDossier,
  RiskAssessmentResult,
  RiskFactor,
} from '../contracts/types/compliance-dossier.types.js';
import { RISK_FACTOR_DESCRIPTIONS } from './risk.factors.js';

interface RuleCondition {
  path: string;
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'truthy' | 'array_not_empty';
  value?: unknown;
}

export function evaluateCondition(dossier: ComplianceDossier, condition: RuleCondition): boolean {
  const actual = getPathValue(dossier, condition.path);

  switch (condition.operator) {
    case 'eq':
      return actual === condition.value;
    case 'neq':
      return actual !== condition.value;
    case 'gt':
      return Number(actual) > Number(condition.value);
    case 'gte':
      return Number(actual) >= Number(condition.value);
    case 'lt':
      return Number(actual) < Number(condition.value);
    case 'lte':
      return Number(actual) <= Number(condition.value);
    case 'truthy':
      return Boolean(actual);
    case 'array_not_empty':
      return Array.isArray(actual) && actual.length > 0;
    default:
      return false;
  }
}

function getPathValue(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function scoreToLevel(score: number): RiskLevel {
  if (score >= 75) return RiskLevel.muito_alto;
  if (score >= 50) return RiskLevel.alto;
  if (score >= 25) return RiskLevel.medio;
  return RiskLevel.baixo;
}

function levelToStatus(level: RiskLevel, blocked: boolean): ComplianceStatus {
  if (blocked) return ComplianceStatus.rejeitado;
  if (level === RiskLevel.baixo) return ComplianceStatus.aprovado;
  if (level === RiskLevel.medio) return ComplianceStatus.pendente;
  if (level === RiskLevel.alto) return ComplianceStatus.revisao_manual;
  return ComplianceStatus.rejeitado;
}

const LEVEL_ORDER = [RiskLevel.baixo, RiskLevel.medio, RiskLevel.alto, RiskLevel.muito_alto];

function maxLevel(a: RiskLevel, b: RiskLevel): RiskLevel {
  return LEVEL_ORDER.indexOf(a) >= LEVEL_ORDER.indexOf(b) ? a : b;
}

export function evaluateRisk(
  dossier: ComplianceDossier,
  rules: RiskRule[],
  documentType: DocumentType,
): RiskAssessmentResult {
  const applicable = rules.filter((r) => r.isActive && r.documentTypes.includes(documentType));

  const factors: RiskFactor[] = [];
  let score = 0;
  let blocked = false;
  let minLevel: RiskLevel | null = null;

  for (const rule of applicable) {
    const condition = rule.condition as unknown as RuleCondition;
    if (!evaluateCondition(dossier, condition)) continue;

    factors.push({
      code: rule.code,
      severity: rule.severity,
      weight: rule.weight,
      description: RISK_FACTOR_DESCRIPTIONS[rule.code] ?? rule.name,
    });

    score += rule.weight;
    if (rule.hardStop) blocked = true;
    if (rule.minRiskLevel) {
      minLevel = minLevel
        ? maxLevel(minLevel, rule.minRiskLevel as RiskLevel)
        : (rule.minRiskLevel as RiskLevel);
    }
  }

  score = Math.min(score, 100);
  let level = scoreToLevel(score);
  if (minLevel) level = maxLevel(level, minLevel);

  const complianceStatus = levelToStatus(level, blocked);
  const requiresManualReview =
    complianceStatus === ComplianceStatus.revisao_manual ||
    complianceStatus === ComplianceStatus.rejeitado;

  let recommendation: string | null = null;
  if (blocked) {
    recommendation = 'Bloqueio automático — análise de compliance obrigatória antes de prosseguir';
  } else if (requiresManualReview) {
    recommendation = 'Encaminhar para análise do Compliance antes de onboarding';
  } else if (level === RiskLevel.medio) {
    recommendation = 'Monitoramento periódico recomendado';
  }

  return {
    level,
    score,
    factors,
    complianceStatus,
    blocked,
    requiresManualReview,
    recommendation,
  };
}
