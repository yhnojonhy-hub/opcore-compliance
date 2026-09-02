export interface FindingFact {
  label: string;
  value: string;
}

const SKIP = new Set(['id', 'document', 'uuid', '_id', 'httpStatus', 'truncated', 'bytes']);

const LABELS: Record<string, string> = {
  aliases: 'Tribunais consultados',
  motivo: 'Motivo',
  objeto: 'Objeto',
  numero: 'Número',
  codigo: 'Código',
  nome: 'Nome',
  cnpj: 'CNPJ',
  cpf: 'CPF',
  convenio: 'Convênio',
  orgaoSuperior: 'Órgão superior',
  orgaoSancionador: 'Órgão sancionador',
  categoriaSancao: 'Categoria da sanção',
  tipoSancao: 'Tipo da sanção',
  nomeSancionado: 'Sancionado',
  dataInicioSancao: 'Início da sanção',
  dataFimSancao: 'Fim da sanção',
  fundamentacaoLegal: 'Fundamento',
  ufSancionado: 'UF',
  descricaoFuncao: 'Função',
  funcao: 'Função',
  numeroProcesso: 'Processo',
  dataAjuizamento: 'Ajuizamento',
};

function humanize(key: string): string {
  return (
    LABELS[key] ??
    key
      .replace(/([A-Z])/g, ' $1')
      .replace(/[_-]+/g, ' ')
      .replace(/^\w/, (letter) => letter.toUpperCase())
      .trim()
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const TRIBUNAL_LABEL: Record<string, string> = {
  tjsp: 'TJSP — São Paulo',
  tjrj: 'TJRJ — Rio de Janeiro',
  tjmg: 'TJMG — Minas Gerais',
  tjrs: 'TJRS — Rio Grande do Sul',
  tjpr: 'TJPR — Paraná',
  tjsc: 'TJSC — Santa Catarina',
  tjba: 'TJBA — Bahia',
  tjce: 'TJCE — Ceará',
  tjpe: 'TJPE — Pernambuco',
  tjdft: 'TJDFT — Distrito Federal',
  trt1: 'TRT-1 — Rio de Janeiro',
  trt2: 'TRT-2 — São Paulo',
  trt3: 'TRT-3 — Minas Gerais',
  trf1: 'TRF-1',
  trf2: 'TRF-2',
  trf3: 'TRF-3',
  trf4: 'TRF-4',
  trf5: 'TRF-5',
  trf6: 'TRF-6',
  stj: 'STJ',
  tst: 'TST',
  tse: 'TSE',
};

const ENDPOINT_LABEL: Record<string, string> = {
  ceis: 'CEIS — inidôneos e suspensos',
  cnep: 'CNEP — Lei Anticorrupção',
  cepim: 'CEPIM — entidades impedidas',
  ceaf: 'CEAF — servidores expulsos',
  'acordos-leniencia': 'Acordos de leniência',
  pep: 'PEP — pessoa politicamente exposta',
  peps: 'PEP — pessoa politicamente exposta',
};

const TCU_LIST_LABEL: Record<string, string> = {
  'responsaveis-inidoneos': 'Licitantes inidôneos',
  'responsaveis-inabilitados': 'Inabilitados para função pública',
  'responsaveis-contas-irregulares': 'Contas irregulares',
  'responsaveis-fins-eleitorais': 'Contas irregulares (efeito eleitoral)',
};

function courtName(alias: string): string {
  const key = alias.toLowerCase();
  return TRIBUNAL_LABEL[key] ?? (alias ? alias.toUpperCase() : 'Tribunal');
}

function tcuListName(path: string): string {
  return TCU_LIST_LABEL[path] ?? path.replace(/[-_]+/g, ' ');
}

function asCount(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function recordsOf(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (isRecord(value)) {
    const nested = Object.values(value).filter(isRecord);
    if (
      nested.length &&
      nested.every((item) => 'status' in item || 'via' in item || 'list' in item)
    ) {
      return nested;
    }
    return [value];
  }
  return [];
}

function formatCourtPayload(rows: Record<string, unknown>[]): FindingFact[] {
  const courts = rows.filter((item) => item.alias != null && String(item.alias));
  if (!courts.length) return [];
  const withHits = courts.filter((item) => (asCount(item.hits) ?? 0) > 0);
  const failed = courts.filter((item) => {
    const code = Number(item.status);
    return item.status != null && code !== 200;
  });
  const names = (list: Record<string, unknown>[]) =>
    list.map((item) => courtName(String(item.alias))).join(', ');
  const total = withHits.reduce((sum, item) => sum + (asCount(item.hits) ?? 0), 0);
  const facts: FindingFact[] = [];
  if (withHits.length === 0 && failed.length === 0) {
    facts.push({
      label: 'Resultado',
      value: 'Nenhum processo encontrado nos tribunais consultados.',
    });
    facts.push({ label: 'Tribunais consultados', value: names(courts) });
    return facts;
  }
  facts.push({
    label: 'Resultado',
    value:
      total > 0
        ? `${total} processo(s) em ${withHits.length} tribunal(is).`
        : 'Nenhum processo encontrado nos tribunais que responderam.',
  });
  for (const item of withHits) {
    facts.push({
      label: courtName(String(item.alias)),
      value: `${asCount(item.hits)} processo(s) neste tribunal.`,
    });
  }
  const clean = courts.filter((item) => !withHits.includes(item) && !failed.includes(item));
  if (clean.length) facts.push({ label: 'Sem processo', value: names(clean) });
  if (failed.length) facts.push({ label: 'Não responderam', value: names(failed) });
  return facts;
}

function formatTcuPayload(rows: Record<string, unknown>[]): FindingFact[] {
  const lists = rows.filter((item) => item.list != null || item.label != null);
  if (!lists.length) return [];
  const facts = lists.map((item) => {
    const label = String(item.label ?? tcuListName(String(item.list ?? '')));
    const hits = asCount(item.hits);
    const code = Number(item.status);
    let value = 'Nada consta nesta lista.';
    if (hits && hits > 0) value = `${hits} registro(s) nesta lista.`;
    else if (item.status != null && code !== 200) value = 'Lista indisponível neste momento.';
    return { label, value };
  });
  const dirty = facts.filter((item) => !item.value.startsWith('Nada consta')).length;
  return [
    {
      label: 'Resultado',
      value:
        dirty === 0
          ? 'Nada consta nas listas do TCU consultadas (inidôneos, inabilitados e contas irregulares).'
          : 'Há registro em lista do TCU. Confira vigência e se o documento é o mesmo alvo.',
    },
    ...facts,
  ];
}

function formatEndpointPayload(rows: Record<string, unknown>[]): FindingFact[] {
  const lists = rows.filter((item) => item.endpoint != null);
  if (!lists.length) return [];
  const facts = lists.map((item) => {
    const endpoint = String(item.endpoint ?? 'fonte');
    const body = item.body;
    const count = Array.isArray(body)
      ? body.length
      : (asCount(item.hits) ?? (body == null ? 0 : 1));
    return {
      label: ENDPOINT_LABEL[endpoint] ?? endpoint.toUpperCase(),
      value: count === 0 ? 'Nada consta nesta lista.' : `${count} registro(s) nesta lista.`,
    };
  });
  const hits = facts.filter((item) => !item.value.startsWith('Nada consta')).length;
  return [
    {
      label: 'Resultado',
      value:
        hits === 0
          ? 'Nada consta nas listas da CGU consultadas nesta busca.'
          : 'Há correspondência em lista da CGU. Confira vigência e o documento do alvo.',
    },
    ...facts,
  ];
}

function formatOpenSanctionsPayload(payload: unknown): FindingFact[] {
  const rows = recordsOf(payload);
  const catalog =
    isRecord(payload) && (payload.rows != null || payload.catalogSize != null)
      ? asCount(payload.catalogSize ?? payload.rows)
      : undefined;
  const matches = rows.reduce((sum, item) => sum + (asCount(item.hits) ?? 0), 0);
  const facts: FindingFact[] = [
    {
      label: 'Resultado',
      value:
        matches > 0
          ? `${matches} correspondência(s) nas listas internacionais.`
          : 'Nenhuma correspondência nas listas internacionais de sanção e pessoas expostas.',
    },
  ];
  if (catalog && catalog > 0) {
    facts.push({
      label: 'Base consultada',
      value: `Lista pública com ${catalog.toLocaleString('pt-BR')} registros.`,
    });
  }
  return facts;
}

function formatProbePayload(rows: Record<string, unknown>[], sourceName: string): FindingFact[] {
  const failed = rows.filter((item) => item.status != null && Number(item.status) !== 200);
  const name = sourceName || 'Esta fonte';
  if (failed.length && failed.length === rows.length) {
    return [{ label: 'Resultado', value: `${name} não respondeu nesta consulta.` }];
  }
  return [
    {
      label: 'Resultado',
      value: `${name} foi consultada. O resultado tratado está nos achados acima.`,
    },
  ];
}

function formatSourcePayload(payload: unknown, sourceName = ''): FindingFact[] {
  if (payload == null) return [];
  const name = sourceName.toLowerCase();
  const rows = recordsOf(payload);

  if (rows.some((item) => item.alias != null) || name.includes('datajud')) {
    const courts = formatCourtPayload(rows);
    if (courts.length) return courts;
  }
  if (rows.some((item) => item.list != null) || name.includes('tcu')) {
    const lists = formatTcuPayload(rows);
    if (lists.length) return lists;
  }
  if (
    rows.some((item) => item.endpoint != null) ||
    name.includes('transparência') ||
    name.includes('transparencia')
  ) {
    const lists = formatEndpointPayload(rows);
    if (lists.length) return lists;
  }
  if (
    name.includes('opensanctions') ||
    (isRecord(payload) && ('csvStatus' in payload || 'catalogSize' in payload))
  ) {
    return formatOpenSanctionsPayload(payload);
  }
  if (isRecord(payload) && 'matched' in payload) {
    return [
      {
        label: 'Resultado',
        value: payload.matched
          ? 'Há correspondência nesta lista. Confira se o nome é o mesmo alvo.'
          : 'Nada consta nesta lista.',
      },
    ];
  }
  if (isRecord(payload) && ('count' in payload || 'total' in payload || 'hits' in payload)) {
    const count = asCount(payload.count ?? payload.total ?? payload.hits) ?? 0;
    return [
      {
        label: 'Resultado',
        value: count === 0 ? 'Nada consta nesta consulta.' : `${count} registro(s) nesta consulta.`,
      },
    ];
  }
  if (
    rows.some(
      (item) =>
        item.via != null || (item.status != null && item.alias == null && item.list == null),
    )
  ) {
    return formatProbePayload(rows, sourceName);
  }
  if (Array.isArray(payload)) {
    return payload
      .flatMap((item, index) =>
        formatFindingFacts(item).map((fact) => ({
          ...fact,
          label: payload.length > 1 ? `${fact.label} (${index + 1})` : fact.label,
        })),
      )
      .slice(0, 24);
  }
  const facts = formatFindingFacts(payload).filter(
    (fact) => !/^(via|status|query|csv status|alias|endpoint)$/i.test(fact.label),
  );
  return facts.length
    ? facts
    : [{ label: 'Resultado', value: 'Consulta registrada sem detalhe adicional.' }];
}

export function formatFindingFacts(details: unknown, depth = 0, prefix = ''): FindingFact[] {
  if (!isRecord(details)) return [];
  const facts: FindingFact[] = [];
  for (const [key, value] of Object.entries(details)) {
    if (SKIP.has(key) || value == null || value === '') continue;
    const label = prefix ? `${prefix} · ${humanize(key)}` : humanize(key);
    if (Array.isArray(value)) {
      if (value.every((item) => item == null || typeof item !== 'object')) {
        const text = value.map(String).filter(Boolean).join(', ');
        if (text) facts.push({ label, value: text });
      } else if (depth < 2) {
        value.slice(0, 4).forEach((item, index) => {
          facts.push(...formatFindingFacts(item, depth + 1, `${label} ${index + 1}`));
        });
      }
      continue;
    }
    if (isRecord(value)) {
      if (depth < 3) facts.push(...formatFindingFacts(value, depth + 1, label));
      continue;
    }
    const text = String(value).trim();
    if (text && text !== '[object Object]') facts.push({ label, value: text });
  }
  return facts.slice(0, 24);
}

export function portalFindingText(
  item: Record<string, unknown>,
  fallback: string,
): {
  titleName: string;
  summary: string;
} {
  const sanctioned =
    item.sancionado && typeof item.sancionado === 'object' && !Array.isArray(item.sancionado)
      ? (item.sancionado as Record<string, unknown>)
      : {};
  const convenio =
    item.convenio && typeof item.convenio === 'object' && !Array.isArray(item.convenio)
      ? (item.convenio as Record<string, unknown>)
      : {};
  const orgao =
    item.orgaoSuperior &&
    typeof item.orgaoSuperior === 'object' &&
    !Array.isArray(item.orgaoSuperior)
      ? (item.orgaoSuperior as Record<string, unknown>)
      : {};
  const titleName = String(
    item.nomeSancionado ??
      sanctioned.nome ??
      item.nome ??
      item.motivo ??
      convenio.numero ??
      fallback,
  );
  const parts = [
    item.categoriaSancao,
    item.tipoSancao,
    item.motivo,
    convenio.objeto,
    orgao.nome,
    item.orgaoSancionador,
  ]
    .map((value) =>
      String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
    .map((value) => (value.length > 160 ? `${value.slice(0, 157)}…` : value));
  return {
    titleName,
    summary: parts.slice(0, 3).join(' · ') || 'Sanção encontrada',
  };
}
