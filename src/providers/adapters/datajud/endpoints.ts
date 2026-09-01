/**
 * Catálogo oficial DataJud → URL _search
 * https://datajud-wiki.cnj.jus.br/api-publica/endpoints/
 */
const BASE = 'https://api-publica.datajud.cnj.jus.br';

export type DataJudTribunalGroup =
  | 'Tribunais Superiores'
  | 'Justiça Federal'
  | 'Justiça Estadual'
  | 'Justiça do Trabalho'
  | 'Justiça Eleitoral'
  | 'Justiça Militar';

export interface DataJudTribunal {
  alias: string;
  label: string;
  group: DataJudTribunalGroup;
}

function url(alias: string): string {
  return `${BASE}/api_publica_${alias}/_search`;
}

/** Catálogo completo (fonte: wiki DataJud) */
export const DATAJUD_TRIBUNAL_CATALOG: DataJudTribunal[] = [
  // Tribunais Superiores
  { alias: 'tst', label: 'Tribunal Superior do Trabalho', group: 'Tribunais Superiores' },
  { alias: 'tse', label: 'Tribunal Superior Eleitoral', group: 'Tribunais Superiores' },
  { alias: 'stj', label: 'Tribunal Superior de Justiça', group: 'Tribunais Superiores' },
  { alias: 'stm', label: 'Tribunal Superior Militar', group: 'Tribunais Superiores' },
  // Justiça Federal
  { alias: 'trf1', label: 'Tribunal Regional Federal da 1ª Região', group: 'Justiça Federal' },
  { alias: 'trf2', label: 'Tribunal Regional Federal da 2ª Região', group: 'Justiça Federal' },
  { alias: 'trf3', label: 'Tribunal Regional Federal da 3ª Região', group: 'Justiça Federal' },
  { alias: 'trf4', label: 'Tribunal Regional Federal da 4ª Região', group: 'Justiça Federal' },
  { alias: 'trf5', label: 'Tribunal Regional Federal da 5ª Região', group: 'Justiça Federal' },
  { alias: 'trf6', label: 'Tribunal Regional Federal da 6ª Região', group: 'Justiça Federal' },
  // Justiça Estadual
  { alias: 'tjac', label: 'Tribunal de Justiça do Acre', group: 'Justiça Estadual' },
  { alias: 'tjal', label: 'Tribunal de Justiça de Alagoas', group: 'Justiça Estadual' },
  { alias: 'tjam', label: 'Tribunal de Justiça do Amazonas', group: 'Justiça Estadual' },
  { alias: 'tjap', label: 'Tribunal de Justiça do Amapá', group: 'Justiça Estadual' },
  { alias: 'tjba', label: 'Tribunal de Justiça da Bahia', group: 'Justiça Estadual' },
  { alias: 'tjce', label: 'Tribunal de Justiça do Ceará', group: 'Justiça Estadual' },
  {
    alias: 'tjdft',
    label: 'TJ do Distrito Federal e Territórios',
    group: 'Justiça Estadual',
  },
  { alias: 'tjes', label: 'Tribunal de Justiça do Espírito Santo', group: 'Justiça Estadual' },
  { alias: 'tjgo', label: 'Tribunal de Justiça do Goiás', group: 'Justiça Estadual' },
  { alias: 'tjma', label: 'Tribunal de Justiça do Maranhão', group: 'Justiça Estadual' },
  { alias: 'tjmg', label: 'Tribunal de Justiça de Minas Gerais', group: 'Justiça Estadual' },
  { alias: 'tjms', label: 'TJ do Mato Grosso do Sul', group: 'Justiça Estadual' },
  { alias: 'tjmt', label: 'Tribunal de Justiça do Mato Grosso', group: 'Justiça Estadual' },
  { alias: 'tjpa', label: 'Tribunal de Justiça do Pará', group: 'Justiça Estadual' },
  { alias: 'tjpb', label: 'Tribunal de Justiça da Paraíba', group: 'Justiça Estadual' },
  { alias: 'tjpe', label: 'Tribunal de Justiça de Pernambuco', group: 'Justiça Estadual' },
  { alias: 'tjpi', label: 'Tribunal de Justiça do Piauí', group: 'Justiça Estadual' },
  { alias: 'tjpr', label: 'Tribunal de Justiça do Paraná', group: 'Justiça Estadual' },
  { alias: 'tjrj', label: 'Tribunal de Justiça do Rio de Janeiro', group: 'Justiça Estadual' },
  { alias: 'tjrn', label: 'TJ do Rio Grande do Norte', group: 'Justiça Estadual' },
  { alias: 'tjro', label: 'Tribunal de Justiça de Rondônia', group: 'Justiça Estadual' },
  { alias: 'tjrr', label: 'Tribunal de Justiça de Roraima', group: 'Justiça Estadual' },
  { alias: 'tjrs', label: 'Tribunal de Justiça do Rio Grande do Sul', group: 'Justiça Estadual' },
  { alias: 'tjsc', label: 'Tribunal de Justiça de Santa Catarina', group: 'Justiça Estadual' },
  { alias: 'tjse', label: 'Tribunal de Justiça de Sergipe', group: 'Justiça Estadual' },
  { alias: 'tjsp', label: 'Tribunal de Justiça de São Paulo', group: 'Justiça Estadual' },
  { alias: 'tjto', label: 'Tribunal de Justiça do Tocantins', group: 'Justiça Estadual' },
  // Justiça do Trabalho
  ...Array.from({ length: 24 }, (_, i) => {
    const n = i + 1;
    return {
      alias: `trt${n}`,
      label: `Tribunal Regional do Trabalho da ${n}ª Região`,
      group: 'Justiça do Trabalho' as DataJudTribunalGroup,
    };
  }),
  // Justiça Eleitoral
  { alias: 'tre-ac', label: 'Tribunal Regional Eleitoral do Acre', group: 'Justiça Eleitoral' },
  { alias: 'tre-al', label: 'Tribunal Regional Eleitoral de Alagoas', group: 'Justiça Eleitoral' },
  { alias: 'tre-am', label: 'Tribunal Regional Eleitoral do Amazonas', group: 'Justiça Eleitoral' },
  { alias: 'tre-ap', label: 'Tribunal Regional Eleitoral do Amapá', group: 'Justiça Eleitoral' },
  { alias: 'tre-ba', label: 'Tribunal Regional Eleitoral da Bahia', group: 'Justiça Eleitoral' },
  { alias: 'tre-ce', label: 'Tribunal Regional Eleitoral do Ceará', group: 'Justiça Eleitoral' },
  {
    alias: 'tre-dft',
    label: 'Tribunal Regional Eleitoral do Distrito Federal',
    group: 'Justiça Eleitoral',
  },
  {
    alias: 'tre-es',
    label: 'Tribunal Regional Eleitoral do Espírito Santo',
    group: 'Justiça Eleitoral',
  },
  { alias: 'tre-go', label: 'Tribunal Regional Eleitoral de Goiás', group: 'Justiça Eleitoral' },
  { alias: 'tre-ma', label: 'Tribunal Regional Eleitoral do Maranhão', group: 'Justiça Eleitoral' },
  {
    alias: 'tre-mg',
    label: 'Tribunal Regional Eleitoral de Minas Gerais',
    group: 'Justiça Eleitoral',
  },
  {
    alias: 'tre-ms',
    label: 'Tribunal Regional Eleitoral do Mato Grosso do Sul',
    group: 'Justiça Eleitoral',
  },
  {
    alias: 'tre-mt',
    label: 'Tribunal Regional Eleitoral do Mato Grosso',
    group: 'Justiça Eleitoral',
  },
  { alias: 'tre-pa', label: 'Tribunal Regional Eleitoral do Pará', group: 'Justiça Eleitoral' },
  { alias: 'tre-pb', label: 'Tribunal Regional Eleitoral da Paraíba', group: 'Justiça Eleitoral' },
  {
    alias: 'tre-pe',
    label: 'Tribunal Regional Eleitoral de Pernambuco',
    group: 'Justiça Eleitoral',
  },
  { alias: 'tre-pi', label: 'Tribunal Regional Eleitoral do Piauí', group: 'Justiça Eleitoral' },
  { alias: 'tre-pr', label: 'Tribunal Regional Eleitoral do Paraná', group: 'Justiça Eleitoral' },
  {
    alias: 'tre-rj',
    label: 'Tribunal Regional Eleitoral do Rio de Janeiro',
    group: 'Justiça Eleitoral',
  },
  {
    alias: 'tre-rn',
    label: 'Tribunal Regional Eleitoral do Rio Grande do Norte',
    group: 'Justiça Eleitoral',
  },
  { alias: 'tre-ro', label: 'Tribunal Regional Eleitoral de Rondônia', group: 'Justiça Eleitoral' },
  { alias: 'tre-rr', label: 'Tribunal Regional Eleitoral de Roraima', group: 'Justiça Eleitoral' },
  {
    alias: 'tre-rs',
    label: 'Tribunal Regional Eleitoral do Rio Grande do Sul',
    group: 'Justiça Eleitoral',
  },
  {
    alias: 'tre-sc',
    label: 'Tribunal Regional Eleitoral de Santa Catarina',
    group: 'Justiça Eleitoral',
  },
  { alias: 'tre-se', label: 'Tribunal Regional Eleitoral de Sergipe', group: 'Justiça Eleitoral' },
  {
    alias: 'tre-sp',
    label: 'Tribunal Regional Eleitoral de São Paulo',
    group: 'Justiça Eleitoral',
  },
  {
    alias: 'tre-to',
    label: 'Tribunal Regional Eleitoral do Tocantins',
    group: 'Justiça Eleitoral',
  },
  // Justiça Militar
  {
    alias: 'tjmmg',
    label: 'Tribunal de Justiça Militar de Minas Gerais',
    group: 'Justiça Militar',
  },
  {
    alias: 'tjmrs',
    label: 'Tribunal de Justiça Militar do Rio Grande do Sul',
    group: 'Justiça Militar',
  },
  {
    alias: 'tjmsp',
    label: 'Tribunal de Justiça Militar de São Paulo',
    group: 'Justiça Militar',
  },
];

export const DATAJUD_SEARCH_URL: Record<string, string> = Object.fromEntries(
  DATAJUD_TRIBUNAL_CATALOG.map((t) => [t.alias, url(t.alias)]),
);

/** Siglas comuns no cadastro → alias DataJud */
const ALIAS_ALIASES: Record<string, string> = {
  TJSP: 'tjsp',
  TJRJ: 'tjrj',
  TJMG: 'tjmg',
  TJRS: 'tjrs',
  TJPR: 'tjpr',
  TJSC: 'tjsc',
  TJBA: 'tjba',
  TJPE: 'tjpe',
  TJCE: 'tjce',
  TJGO: 'tjgo',
  TJDFT: 'tjdft',
  TJDF: 'tjdft',
  TRF1: 'trf1',
  TRF2: 'trf2',
  TRF3: 'trf3',
  TRF4: 'trf4',
  TRF5: 'trf5',
  TRF6: 'trf6',
  STJ: 'stj',
  TST: 'tst',
  TSE: 'tse',
  STM: 'stm',
};

const GROUP_ORDER: DataJudTribunalGroup[] = [
  'Tribunais Superiores',
  'Justiça Federal',
  'Justiça Estadual',
  'Justiça do Trabalho',
  'Justiça Eleitoral',
  'Justiça Militar',
];

/**
 * Código J+TR do número CNJ (20 dígitos) → alias DataJud.
 * Ex.: 8.26 (estadual SP) → "826" → tjsp
 */
export const CNJ_JTR_TO_ALIAS: Record<string, string> = {
  '801': 'tjac',
  '802': 'tjal',
  '803': 'tjam',
  '804': 'tjap',
  '805': 'tjba',
  '806': 'tjce',
  '807': 'tjdft',
  '808': 'tjes',
  '809': 'tjgo',
  '810': 'tjma',
  '811': 'tjmt',
  '812': 'tjms',
  '813': 'tjmg',
  '814': 'tjpa',
  '815': 'tjpb',
  '816': 'tjpe',
  '817': 'tjpi',
  '818': 'tjpr',
  '819': 'tjrj',
  '820': 'tjrn',
  '821': 'tjro',
  '822': 'tjrr',
  '823': 'tjrs',
  '824': 'tjsc',
  '825': 'tjse',
  '826': 'tjsp',
  '827': 'tjto',
  '301': 'trf1',
  '302': 'trf2',
  '303': 'trf3',
  '304': 'trf4',
  '305': 'trf5',
  '306': 'trf6',
};

export function listDataJudTribunals(): DataJudTribunal[] {
  return [...DATAJUD_TRIBUNAL_CATALOG].sort((a, b) => {
    const ga = GROUP_ORDER.indexOf(a.group);
    const gb = GROUP_ORDER.indexOf(b.group);
    if (ga !== gb) return ga - gb;
    return a.label.localeCompare(b.label, 'pt-BR');
  });
}

export function normalizeAlias(input: string): string {
  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();
  if (DATAJUD_SEARCH_URL[lower]) return lower;

  const upper = trimmed.toUpperCase().replace(/\s/g, '');
  if (ALIAS_ALIASES[upper]) return ALIAS_ALIASES[upper];

  const sanitized = lower.replace(/[^a-z0-9-]/g, '');
  if (DATAJUD_SEARCH_URL[sanitized]) return sanitized;

  const noHyphen = sanitized.replace(/-/g, '');
  if (DATAJUD_SEARCH_URL[noHyphen]) return noHyphen;

  return sanitized;
}

export function resolveEndpoint(aliasOrTribunal: string): string | null {
  const alias = normalizeAlias(aliasOrTribunal);
  return DATAJUD_SEARCH_URL[alias] ?? null;
}

export function isValidDataJudTribunal(aliasOrTribunal: string): boolean {
  return resolveEndpoint(aliasOrTribunal) !== null;
}
