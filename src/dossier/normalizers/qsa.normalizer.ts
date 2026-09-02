import type { QsaMember } from '../../contracts/types/canonical/pj.types.js';
import { asList } from '../../contracts/utils/array.util.js';
import { asRecord, readNumber, readString } from './read.util.js';

export function normalizeQsaMember(raw: unknown): QsaMember {
  const record = asRecord(raw);
  return {
    name: readString(
      record.nome_socio,
      record.nome,
      record.name,
      record.Name,
      record.Nome,
      record.socio_nome,
    ),
    document: readString(
      record.cnpj_cpf_do_socio,
      record.cpf_cnpj_socio,
      record.document,
      record.cpf,
      record.cnpj,
      record.TaxIdNumber,
    ),
    role: readString(
      record.qualificacao_socio,
      record.qualificacao,
      record.qualificacao_representante,
      record.role,
      record.cargo,
      record.RelationshipType,
    ),
    sharePercent: readNumber(
      record.percentual_capital_social,
      record.percentual,
      record.sharePercent,
      record.participacao,
      record.ParticipationPercentage,
    ),
  };
}

export function normalizeQsaList(items: unknown): QsaMember[] {
  return asList(items)
    .map(normalizeQsaMember)
    .filter((item) => item.name != null || item.document != null);
}

const QSA_PATH = 'sections.corporateStructure.qsa';

export function normalizeQsaInMapped(mapped: Record<string, unknown>): void {
  const value = mapped[QSA_PATH];
  if (!Array.isArray(value) || value.length === 0) return;
  mapped[QSA_PATH] = normalizeQsaList(value);
}
