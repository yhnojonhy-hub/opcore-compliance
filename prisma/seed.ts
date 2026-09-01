import { prisma } from '../src/db/prisma.js';
import { loadProviderSeed, ALL_PROVIDER_SEED_FILES } from './provider-seeds.manifest.js';

const riskRules = [
  {
    code: 'RESTRICTIVE_LIST_HIT',
    name: 'Lista restritiva / CEIS',
    documentTypes: ['CPF', 'CNPJ'],
    condition: {
      or: [
        {
          documentType: 'CPF',
          path: 'sections.pldft.restrictiveListHits',
          operator: 'array_not_empty',
        },
        {
          documentType: 'CNPJ',
          path: 'sections.sanctions.ceisRecords',
          operator: 'array_not_empty',
        },
      ],
    },
    weight: 100,
    severity: 'critica',
    hardStop: true,
    minRiskLevel: 'muito_alto',
  },
  {
    code: 'SANCTIONS_HIT',
    name: 'Sanções internacionais',
    documentTypes: ['CPF', 'CNPJ'],
    condition: {
      or: [
        { documentType: 'CPF', path: 'sections.pldft.sanctionsHits', operator: 'array_not_empty' },
        {
          documentType: 'CNPJ',
          path: 'sections.sanctions.internationalHits',
          operator: 'array_not_empty',
        },
      ],
    },
    weight: 60,
    severity: 'alta',
    hardStop: false,
  },
  {
    code: 'PEP_FLAG',
    name: 'PEP identificado',
    documentTypes: ['CPF'],
    condition: { path: 'sections.pldft.isPep', operator: 'truthy' },
    weight: 40,
    severity: 'alta',
    hardStop: false,
    minRiskLevel: 'alto',
  },
  {
    code: 'PJ_PEP_ENTITY',
    name: 'PEP em entidade PJ',
    documentTypes: ['CNPJ'],
    condition: { path: 'sections.sanctions.isCurrentlyPep', operator: 'truthy' },
    weight: 40,
    severity: 'alta',
    hardStop: false,
    minRiskLevel: 'alto',
  },
  {
    code: 'PJ_SANCTIONED',
    name: 'Empresa sancionada',
    documentTypes: ['CNPJ'],
    condition: { path: 'sections.sanctions.isCurrentlySanctioned', operator: 'truthy' },
    weight: 80,
    severity: 'critica',
    hardStop: true,
    minRiskLevel: 'muito_alto',
  },
  {
    code: 'CNPJ_IRREGULAR',
    name: 'CNPJ com situação irregular',
    documentTypes: ['CNPJ'],
    condition: {
      and: [
        { path: 'sections.cadastral.cnpjStatus', operator: 'truthy' },
        { path: 'sections.cadastral.cnpjStatus', operator: 'neq', value: 'ATIVA' },
      ],
    },
    weight: 50,
    severity: 'alta',
    hardStop: false,
    minRiskLevel: 'alto',
  },
  {
    code: 'CRIMINAL_RECORD',
    name: 'Antecedente criminal',
    documentTypes: ['CPF'],
    condition: { path: 'sections.litigation.criminalRecords', operator: 'array_not_empty' },
    weight: 50,
    severity: 'alta',
    hardStop: false,
  },
  {
    code: 'BANKRUPTCY',
    name: 'Falência ou recuperação',
    documentTypes: ['CNPJ'],
    condition: { path: 'sections.fiscalHealth.bankruptcy', operator: 'truthy' },
    weight: 45,
    severity: 'alta',
    hardStop: false,
  },
  {
    code: 'PROTEST_THRESHOLD',
    name: 'Protestos elevados',
    documentTypes: ['CPF', 'CNPJ'],
    condition: {
      or: [
        { documentType: 'CPF', path: 'sections.financial.protests', operator: 'array_not_empty' },
        {
          documentType: 'CNPJ',
          path: 'sections.fiscalHealth.protests',
          operator: 'array_not_empty',
        },
      ],
    },
    weight: 25,
    severity: 'media',
    hardStop: false,
  },
  {
    code: 'COLLECTIONS_PRESENCE',
    name: 'Presença em cobrança',
    documentTypes: ['CNPJ'],
    condition: { path: 'sections.credit.collectionsPresence', operator: 'truthy' },
    weight: 30,
    severity: 'media',
    hardStop: false,
  },
  {
    code: 'CERTIFICATE_NEGATIVE',
    name: 'Certidão negativa',
    documentTypes: ['CNPJ'],
    condition: { path: 'sections.certificates', operator: 'certificate_negative' },
    weight: 50,
    severity: 'alta',
    hardStop: false,
    minRiskLevel: 'alto',
  },
  {
    code: 'ESG_SLAVE_LABOR',
    name: 'Trabalho escravo MTE',
    documentTypes: ['CPF', 'CNPJ'],
    condition: {
      or: [
        { documentType: 'CPF', path: 'sections.esg.slaveLabor', operator: 'truthy' },
        {
          documentType: 'CNPJ',
          path: 'sections.litigationEsg.laborCompliance',
          operator: 'truthy',
        },
      ],
    },
    weight: 70,
    severity: 'critica',
    hardStop: true,
    minRiskLevel: 'muito_alto',
  },
  {
    code: 'ENVIRONMENTAL_EMBARGO',
    name: 'Embargo ambiental',
    documentTypes: ['CPF', 'CNPJ'],
    condition: {
      or: [
        {
          documentType: 'CPF',
          path: 'sections.esg.environmentalEmbargoes',
          operator: 'array_not_empty',
        },
        {
          documentType: 'CNPJ',
          path: 'sections.litigationEsg.environmentalEmbargoes',
          operator: 'array_not_empty',
        },
      ],
    },
    weight: 35,
    severity: 'media',
    hardStop: false,
  },
  {
    code: 'DATA_INCOMPLETE',
    name: 'Dados incompletos',
    documentTypes: ['CPF', 'CNPJ'],
    condition: { path: 'meta.completeness', operator: 'lt', value: 0.5 },
    weight: 10,
    severity: 'baixa',
    hardStop: false,
  },
];

async function upsertProvider(config: ReturnType<typeof loadProviderSeed>) {
  await prisma.provider.upsert({
    where: { slug: config.slug },
    create: {
      slug: config.slug,
      name: config.name,
      baseUrl: config.baseUrl,
      httpMethod: config.httpMethod,
      requestTemplate: config.requestTemplate,
      authType: config.authType,
      authConfigRef: config.authConfigRef ?? null,
      fieldMappings: config.fieldMappings,
      supportedTypes: config.supportedTypes,
      isActive: config.isActive,
      priority: config.priority,
    },
    update: {
      name: config.name,
      baseUrl: config.baseUrl,
      httpMethod: config.httpMethod,
      requestTemplate: config.requestTemplate,
      authType: config.authType,
      fieldMappings: config.fieldMappings,
      supportedTypes: config.supportedTypes,
      isActive: config.isActive,
      priority: config.priority,
    },
  });
}

async function main() {
  for (const file of ALL_PROVIDER_SEED_FILES) {
    await upsertProvider(loadProviderSeed(file));
  }

  for (const rule of riskRules) {
    await prisma.riskRule.upsert({
      where: { code: rule.code },
      create: rule,
      update: rule,
    });
  }

  console.log('Seed concluído: providers + risk rules');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
