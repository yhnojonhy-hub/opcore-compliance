/**
 * Generates BigDataCorp provider seeds from official docs index (llms.txt).
 * Run: npm run generate:bdc-catalog
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEEDS_DIR = join(ROOT, 'prisma/seeds/providers/bigdatacorp');
const DOCS_DIR = join(ROOT, '..', 'docs');
const LLMS_URL = 'https://docs.bigdatacorp.com.br/plataforma/llms.txt';

type Entity = 'pf' | 'pj' | 'both';
type FieldMapping = { source: string; target: string };
type BdcCategory =
  | 'pessoas'
  | 'empresas'
  | 'ondemand'
  | 'marketplace'
  | 'enderecos'
  | 'processos'
  | 'veiculos'
  | 'produtos'
  | 'arquivo'
  | 'modeling';

interface CatalogEntry {
  category: BdcCategory;
  entity: Entity;
  dataset: string;
  title: string;
  docSlug: string;
  docUrl: string;
  schemaBlocks: string[];
  mappingStatus: 'complete' | 'todo';
  fieldMappings: FieldMapping[];
  activationTier: 1 | 2 | 3;
  apiPath: string;
  supportedTypes: ('CPF' | 'CNPJ')[];
}

const PF_KYC_MAPPINGS: FieldMapping[] = [
  { source: '$.Result[0].KycData.IsCurrentlyPEP', target: 'sections.pldft.isPep' },
  { source: '$.Result[0].KycData.IsCurrentlySanctioned', target: 'sections.pldft.isSanctioned' },
  { source: '$.Result[0].KycData.SanctionsHistory', target: 'sections.pldft.sanctionsHits' },
];

const PJ_KYC_MAPPINGS: FieldMapping[] = [
  { source: '$.Result[0].KycData.IsCurrentlyPEP', target: 'sections.sanctions.isCurrentlyPep' },
  {
    source: '$.Result[0].KycData.IsCurrentlySanctioned',
    target: 'sections.sanctions.isCurrentlySanctioned',
  },
  {
    source: '$.Result[0].KycData.WasPreviouslySanctioned',
    target: 'sections.sanctions.wasPreviouslySanctioned',
  },
  {
    source: '$.Result[0].KycData.SanctionsHistory',
    target: 'sections.sanctions.internationalHits',
  },
];

const PF_BASIC_MAPPINGS: FieldMapping[] = [
  { source: '$.Result[0].BasicData.Name', target: 'sections.cadastral.fullName' },
  { source: '$.Result[0].BasicData.TaxIdStatus', target: 'sections.cadastral.cpfStatus' },
  { source: '$.Result[0].BasicData.BirthDate', target: 'sections.cadastral.birthDate' },
  { source: '$.Result[0].BasicData.MotherName', target: 'sections.cadastral.motherName' },
];

const PJ_BASIC_MAPPINGS: FieldMapping[] = [
  { source: '$.Result[0].BasicData.OfficialName', target: 'sections.cadastral.legalName' },
  { source: '$.Result[0].BasicData.TradeName', target: 'sections.cadastral.tradeName' },
  { source: '$.Result[0].BasicData.TaxIdStatus', target: 'sections.cadastral.cnpjStatus' },
  { source: '$.Result[0].BasicData.FoundedDate', target: 'sections.cadastral.openingDate' },
  {
    source: '$.Result[0].BasicData.Activities[?(@.IsMain==true)].Code',
    target: 'sections.cadastral.cnae',
  },
  {
    source: '$.Result[0].BasicData.Activities[?(@.IsMain==true)].Activity',
    target: 'sections.cadastral.cnaeDescription',
  },
  { source: '$.Result[0].BasicData.Activities', target: 'sections.cadastral.activities' },
  {
    source: '$.Result[0].BasicData.AdditionalOutputData.CapitalRS',
    target: 'sections.cadastral.capital',
  },
  {
    source: '$.Result[0].BasicData.LegalNature.Activity',
    target: 'sections.cadastral.legalNature',
  },
  {
    source: '$.Result[0].BasicData.HeadquarterState',
    target: 'sections.cadastral.headquarterState',
  },
  { source: '$.Result[0].BasicData.TaxRegime', target: 'sections.cadastral.taxRegime' },
];

const QSA_MAPPINGS: FieldMapping[] = [
  { source: '$.Result[0].Relationships', target: 'sections.corporateStructure.qsa' },
  { source: '$.Result[0].RelationshipData', target: 'sections.corporateStructure.qsa' },
  { source: '$.Result[0].QSA', target: 'sections.corporateStructure.qsa' },
];

function certMapping(certKey: string): FieldMapping[] {
  return [{ source: '$.Result[0].OnlineCertificates', target: `sections.certificates.${certKey}` }];
}

const DATASET_MAPPINGS: Record<
  string,
  {
    pf?: FieldMapping[];
    pj?: FieldMapping[];
    both?: FieldMapping[];
    blocks: string[];
    tier?: 1 | 2 | 3;
  }
> = {
  basic_data: { pf: PF_BASIC_MAPPINGS, pj: PJ_BASIC_MAPPINGS, blocks: ['cadastral'], tier: 1 },
  kyc: { pf: PF_KYC_MAPPINGS, pj: PJ_KYC_MAPPINGS, blocks: ['pldft', 'sanctions'], tier: 1 },
  owners_kyc: {
    pj: [{ source: '$.Result[0].OwnersKycData', target: 'sections.sanctions.internationalHits' }],
    blocks: ['sanctions'],
    tier: 1,
  },
  employees_kyc: {
    pj: [
      { source: '$.Result[0].EmployeesKycData', target: 'sections.sanctions.internationalHits' },
    ],
    blocks: ['sanctions'],
    tier: 2,
  },
  economic_group_kyc: {
    pj: [
      {
        source: '$.Result[0].EconomicGroupKycData',
        target: 'sections.sanctions.internationalHits',
      },
    ],
    blocks: ['sanctions'],
    tier: 2,
  },
  relationships: { pj: QSA_MAPPINGS, blocks: ['corporateStructure'], tier: 1 },
  dynamic_qsa_data: { pj: QSA_MAPPINGS, blocks: ['corporateStructure'], tier: 1 },
  processes: {
    pf: [
      { source: '$.Result[0].Lawsuits', target: 'sections.litigation.lawsuits' },
      { source: '$.Result[0].Processes', target: 'sections.litigation.lawsuits' },
      { source: '$.Result[0].Processes.Lawsuits', target: 'sections.litigation.lawsuits' },
    ],
    pj: [
      { source: '$.Result[0].Lawsuits', target: 'sections.litigationEsg.lawsuits' },
      { source: '$.Result[0].Processes', target: 'sections.litigationEsg.lawsuits' },
      { source: '$.Result[0].Processes.Lawsuits', target: 'sections.litigationEsg.lawsuits' },
    ],
    blocks: ['litigation', 'litigationEsg'],
    tier: 1,
  },
  lawsuits: {
    pf: [{ source: '$.Result[0].Lawsuits', target: 'sections.litigation.lawsuits' }],
    pj: [{ source: '$.Result[0].Lawsuits', target: 'sections.litigationEsg.lawsuits' }],
    blocks: ['litigation', 'litigationEsg'],
    tier: 1,
  },
  owners_lawsuits: {
    pj: [{ source: '$.Result[0].OwnersLawsuits', target: 'sections.litigationEsg.lawsuits' }],
    blocks: ['litigationEsg'],
    tier: 1,
  },
  protests: {
    pf: [{ source: '$.Result[0].Protests', target: 'sections.financial.protests' }],
    pj: [{ source: '$.Result[0].Protests', target: 'sections.fiscalHealth.protests' }],
    blocks: ['financial', 'fiscalHealth'],
    tier: 1,
  },
  collections: {
    pf: [{ source: '$.Result[0].Collections', target: 'sections.credit.collectionsPresence' }],
    pj: [{ source: '$.Result[0].Collections', target: 'sections.credit.collectionsPresence' }],
    blocks: ['credit', 'fiscalHealth'],
    tier: 1,
  },
  government_debtors: {
    pf: [{ source: '$.Result[0].GovernmentDebtors', target: 'sections.financial.federalDebt' }],
    pj: [{ source: '$.Result[0].GovernmentDebtors', target: 'sections.fiscalHealth.federalDebt' }],
    blocks: ['financial', 'fiscalHealth'],
    tier: 1,
  },
  registration_data: {
    pf: [{ source: '$.Result[0].RegistrationData', target: 'sections.cadastral.registrationData' }],
    pj: [{ source: '$.Result[0].RegistrationData', target: 'sections.cadastral.registrationData' }],
    blocks: ['cadastral'],
    tier: 2,
  },
  addresses_extended: {
    pf: [{ source: '$.Result[0].Addresses', target: 'sections.cadastral.addresses' }],
    pj: [{ source: '$.Result[0].Addresses', target: 'sections.cadastral.addresses' }],
    blocks: ['cadastral'],
    tier: 2,
  },
  emails_extended: {
    pf: [{ source: '$.Result[0].Emails', target: 'sections.cadastral.emails' }],
    pj: [{ source: '$.Result[0].Emails', target: 'sections.cadastral.emails' }],
    blocks: ['cadastral'],
    tier: 2,
  },
  phones_extended: {
    pf: [{ source: '$.Result[0].Phones', target: 'sections.cadastral.phones' }],
    pj: [{ source: '$.Result[0].Phones', target: 'sections.cadastral.phones' }],
    blocks: ['cadastral'],
    tier: 2,
  },
  ondemand_pgfn_company: {
    pj: [
      ...certMapping('pgfn'),
      { source: '$.Result[0].OnlineCertificates', target: 'sections.fiscalHealth.cndFederal' },
    ],
    blocks: ['certificates', 'fiscalHealth'],
    tier: 1,
  },
  ondemand_fgts_company: {
    pj: [
      ...certMapping('fgts'),
      { source: '$.Result[0].OnlineCertificates', target: 'sections.fiscalHealth.crfFgts' },
    ],
    blocks: ['certificates', 'fiscalHealth'],
    tier: 1,
  },
  ondemand_cgu_negative_certificate_company: {
    pj: [
      ...certMapping('cgu'),
      { source: '$.Result[0].OnlineCertificates', target: 'sections.sanctions.ceisRecords' },
    ],
    blocks: ['certificates', 'sanctions'],
    tier: 1,
  },
  ondemand_cnj_negative_certificate_company: {
    pj: certMapping('cnj'),
    blocks: ['certificates'],
    tier: 1,
  },
  ondemand_cert_debt_absence_by_state_company: {
    pj: certMapping('stateDebts'),
    blocks: ['certificates', 'fiscalHealth'],
    tier: 1,
  },
  ondemand_cert_labor_debt_absence_company: {
    pj: certMapping('laborDebts'),
    blocks: ['certificates', 'fiscalHealth'],
    tier: 1,
  },
  ondemand_ibama_embargados_company: {
    pj: [
      ...certMapping('ibamaEmbargoes'),
      {
        source: '$.Result[0].OnlineCertificates',
        target: 'sections.litigationEsg.environmentalEmbargoes',
      },
    ],
    blocks: ['certificates', 'litigationEsg'],
    tier: 1,
  },
  ondemand_ibama_cert_negativa_company: {
    pj: certMapping('ibama'),
    blocks: ['certificates'],
    tier: 1,
  },
  ondemand_labor_lawsuits_certificate_company: {
    pj: [
      ...certMapping('laborLawsuits'),
      {
        source: '$.Result[0].OnlineCertificates',
        target: 'sections.litigationEsg.laborCompliance',
      },
    ],
    blocks: ['certificates', 'litigationEsg'],
    tier: 1,
  },
  partner_ultimate_beneficial_owners_company: {
    pj: [
      {
        source: '$.Result[0].UltimateBeneficialOwners',
        target: 'sections.corporateStructure.uboTree',
      },
      { source: '$.Result[0].UBO', target: 'sections.corporateStructure.uboTree' },
    ],
    blocks: ['corporateStructure'],
    tier: 2,
  },
  cade_processes_data: {
    both: [{ source: '$.Result[0].Processes', target: 'sections.litigationEsg.lawsuits' }],
    blocks: ['litigationEsg'],
    tier: 2,
  },
};

const CATEGORY_DEFAULTS: Record<
  BdcCategory,
  { defaultPath: string; defaultTier: 1 | 2 | 3; entity: Entity }
> = {
  pessoas: { defaultPath: '/pessoas', defaultTier: 2, entity: 'pf' },
  empresas: { defaultPath: '/empresas', defaultTier: 2, entity: 'pj' },
  ondemand: { defaultPath: '/ondemand', defaultTier: 2, entity: 'both' },
  marketplace: { defaultPath: '/marketplace', defaultTier: 3, entity: 'both' },
  enderecos: { defaultPath: '/enderecos', defaultTier: 3, entity: 'both' },
  processos: { defaultPath: '/processos', defaultTier: 2, entity: 'both' },
  veiculos: { defaultPath: '/veiculos', defaultTier: 3, entity: 'both' },
  produtos: { defaultPath: '/produtos', defaultTier: 3, entity: 'both' },
  arquivo: { defaultPath: '/pessoas', defaultTier: 3, entity: 'both' },
  modeling: { defaultPath: '/modelagem', defaultTier: 3, entity: 'both' },
};

const REFERENCE_PREFIXES = [
  'pessoas',
  'empresas',
  'ondemand',
  'marketplace',
  'enderecos',
  'processos',
  'veiculos',
  'produtos',
  'arquivo',
  'dados-unificados',
] as const;

function resolveCategory(docSlug: string): BdcCategory | null {
  for (const prefix of REFERENCE_PREFIXES) {
    if (docSlug === prefix || docSlug.startsWith(`${prefix}-`)) {
      if (prefix === 'dados-unificados') return 'modeling';
      return prefix as BdcCategory;
    }
  }
  return null;
}

function inferEntity(category: BdcCategory, dataset: string, docSlug: string): Entity {
  const defaults = CATEGORY_DEFAULTS[category];
  if (category === 'pessoas') return 'pf';
  if (category === 'empresas') return 'pj';
  if (category === 'arquivo') {
    return docSlug.startsWith('arquivo-empresas') ? 'pj' : 'pf';
  }
  if (dataset.endsWith('_company') || dataset.includes('_company_')) return 'pj';
  if (dataset.endsWith('_person') || dataset.endsWith('_pessoa') || dataset.includes('_person_')) {
    return 'pf';
  }
  return defaults.entity;
}

function entityToSupportedTypes(entity: Entity): ('CPF' | 'CNPJ')[] {
  if (entity === 'pf') return ['CPF'];
  if (entity === 'pj') return ['CNPJ'];
  return ['CPF', 'CNPJ'];
}

function resolveApiPath(category: BdcCategory, entity: Entity, docSlug: string): string {
  if (category === 'arquivo') {
    return entity === 'pj' || docSlug.startsWith('arquivo-empresas') ? '/empresas' : '/pessoas';
  }
  return CATEGORY_DEFAULTS[category].defaultPath;
}

function buildSlug(category: BdcCategory, entity: Entity, dataset: string): string {
  if (category === 'pessoas') return `bigdatacorp-pf-${dataset}`;
  if (category === 'empresas') return `bigdatacorp-pj-${dataset}`;
  const short = category === 'modeling' ? 'modeling' : category;
  const entityTag = entity === 'both' ? 'any' : entity;
  return `bigdatacorp-${short}-${entityTag}-${dataset}`;
}

function shouldActivateTier1(entry: CatalogEntry): boolean {
  if (entry.activationTier !== 1) return false;
  // On-demand/marketplace tier-1 exige contratação explícita — não ativar por default.
  if (entry.category !== 'empresas' && entry.category !== 'pessoas') return false;
  if (entry.entity === 'pj' || entry.supportedTypes.includes('CNPJ')) return true;
  return false;
}

function parseLlmsIndex(
  content: string,
): Omit<
  CatalogEntry,
  | 'fieldMappings'
  | 'mappingStatus'
  | 'schemaBlocks'
  | 'activationTier'
  | 'apiPath'
  | 'supportedTypes'
>[] {
  const entries: Omit<
    CatalogEntry,
    | 'fieldMappings'
    | 'mappingStatus'
    | 'schemaBlocks'
    | 'activationTier'
    | 'apiPath'
    | 'supportedTypes'
  >[] = [];
  const seen = new Set<string>();

  for (const line of content.split('\n')) {
    if (!line.includes('plataforma/reference/')) continue;

    const datasetMatch = line.match(/\*\*Nome técnico do dataset:\*\* `([^`]+)`/);
    if (!datasetMatch) continue;

    const titleMatch = line.match(/^\s*-\s*\[([^\]]+)\]/);
    if (!titleMatch) continue;

    const urlMatch = line.match(/plataforma\/reference\/([^.]+)\.md/);
    if (!urlMatch) continue;

    const docSlug = urlMatch[1];
    const category = resolveCategory(docSlug);
    if (!category) continue;

    const dataset = datasetMatch[1];
    const entity = inferEntity(category, dataset, docSlug);
    const key = `${category}:${entity}:${dataset}`;
    if (seen.has(key)) continue;
    seen.add(key);

    entries.push({
      category,
      entity,
      dataset,
      title: titleMatch[1],
      docSlug,
      docUrl: `https://docs.bigdatacorp.com.br/plataforma/reference/${docSlug}.md`,
    });
  }

  return entries;
}

function enrichEntry(
  raw: Omit<
    CatalogEntry,
    | 'fieldMappings'
    | 'mappingStatus'
    | 'schemaBlocks'
    | 'activationTier'
    | 'apiPath'
    | 'supportedTypes'
  >,
): CatalogEntry {
  const mappingDef = DATASET_MAPPINGS[raw.dataset];
  const entityMappings =
    raw.entity === 'pf'
      ? mappingDef?.pf
      : raw.entity === 'pj'
        ? mappingDef?.pj
        : (mappingDef?.both ?? mappingDef?.pf ?? mappingDef?.pj);
  const fieldMappings = entityMappings ?? mappingDef?.both ?? [];
  const schemaBlocks = mappingDef?.blocks ?? [];
  const mappingStatus = fieldMappings.length > 0 ? 'complete' : 'todo';
  const activationTier = mappingDef?.tier ?? CATEGORY_DEFAULTS[raw.category].defaultTier;
  const apiPath = resolveApiPath(raw.category, raw.entity, raw.docSlug);
  const supportedTypes = entityToSupportedTypes(raw.entity);

  return {
    ...raw,
    schemaBlocks,
    mappingStatus,
    fieldMappings,
    activationTier,
    apiPath,
    supportedTypes,
  };
}

function buildSeed(entry: CatalogEntry) {
  const slug = buildSlug(entry.category, entry.entity, entry.dataset);
  const subDir = entry.category === 'modeling' ? 'modeling' : entry.category;

  return {
    subDir,
    fileName: `${slug}.json`,
    seed: {
      slug,
      name: `BigDataCorp — ${entry.title}`,
      baseUrl: 'https://plataforma.bigdatacorp.com.br',
      httpMethod: 'POST',
      requestTemplate: {
        path: entry.apiPath,
        _bdcMeta: {
          category: entry.category,
          activationTier: entry.activationTier,
          dataset: entry.dataset,
          schemaBlocks: entry.schemaBlocks,
        },
        headers: {
          Accept: 'application/json',
          AccessToken: 'env:BIGDATACORP_ACCESS_TOKEN',
          TokenId: 'env:BIGDATACORP_TOKEN_ID',
        },
        body: {
          Datasets: entry.dataset,
          q: 'doc{{{document}}}',
          Limit: 1,
        },
      },
      authType: 'env_headers',
      fieldMappings: entry.fieldMappings,
      supportedTypes: entry.supportedTypes,
      isActive: shouldActivateTier1(entry),
      priority: entry.activationTier === 1 ? 20 : entry.activationTier === 2 ? 50 : 80,
    },
  };
}

async function fetchLlms(): Promise<string> {
  const res = await fetch(LLMS_URL);
  if (!res.ok) throw new Error(`Failed to fetch llms.txt: ${res.status}`);
  return res.text();
}

function cleanSeedsDir() {
  if (!readdirSync(join(ROOT, 'prisma/seeds/providers')).includes('bigdatacorp')) return;
  rmSync(SEEDS_DIR, { recursive: true, force: true });
}

function writeManifest(seedFiles: string[]) {
  const relPaths = seedFiles.map((f) => `providers/bigdatacorp/${f}`);
  const content = `/** Auto-generated by scripts/generate-bdc-catalog.ts — do not edit manually */
export const BIGDATACORP_SEED_FILES = [
${relPaths.map((p) => `  '${p}',`).join('\n')}
] as const;

export type BigDataCorpSeedFile = (typeof BIGDATACORP_SEED_FILES)[number];
`;
  writeFileSync(join(ROOT, 'prisma/bigdatacorp-seeds.manifest.ts'), content, 'utf-8');
}

function writeCatalogMd(entries: CatalogEntry[]) {
  const lines = [
    '# BIGDATACORP-CATALOG — Datasets da Plataforma de Dados',
    '',
    'Gerado automaticamente a partir de [llms.txt](https://docs.bigdatacorp.com.br/plataforma/llms.txt).',
    '',
    '| Slug | Categoria | Dataset | Entidade | Tier | Blocos SCHEMA | Mapping | Documentação |',
    '|------|-----------|---------|----------|------|---------------|---------|--------------|',
  ];

  for (const e of entries.sort((a, b) => a.dataset.localeCompare(b.dataset))) {
    const slug = buildSlug(e.category, e.entity, e.dataset);
    lines.push(
      `| \`${slug}\` | ${e.category} | \`${e.dataset}\` | ${e.entity.toUpperCase()} | ${e.activationTier} | ${e.schemaBlocks.join(', ') || '—'} | ${e.mappingStatus} | [doc](${e.docUrl}) |`,
    );
  }

  writeFileSync(join(DOCS_DIR, 'BIGDATACORP-CATALOG.md'), `${lines.join('\n')}\n`, 'utf-8');
}

async function main() {
  console.log('Fetching llms.txt...');
  const llms = await fetchLlms();
  const rawEntries = parseLlmsIndex(llms);
  console.log(`Found ${rawEntries.length} dataset reference pages`);

  cleanSeedsDir();
  mkdirSync(SEEDS_DIR, { recursive: true });

  const entries = rawEntries.map(enrichEntry);
  const seedFiles: string[] = [];

  for (const entry of entries) {
    const { subDir, fileName, seed } = buildSeed(entry);
    const dir = join(SEEDS_DIR, subDir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, fileName), `${JSON.stringify(seed, null, 2)}\n`, 'utf-8');
    seedFiles.push(`${subDir}/${fileName}`);
  }

  seedFiles.sort();
  writeManifest(seedFiles);
  writeCatalogMd(entries);

  const complete = entries.filter((e) => e.mappingStatus === 'complete').length;
  const tier1 = entries.filter((e) => e.activationTier === 1).length;
  console.log(`Wrote ${seedFiles.length} seeds (${complete} with fieldMappings, ${tier1} tier-1)`);
  console.log('Manifest: prisma/bigdatacorp-seeds.manifest.ts');
  console.log('Catalog: docs/BIGDATACORP-CATALOG.md');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
