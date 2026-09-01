import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '../src/db/prisma.js';
const seedsDir = join(dirname(fileURLToPath(import.meta.url)), 'seeds');

function loadJson(name: string) {
  return JSON.parse(readFileSync(join(seedsDir, name), 'utf-8'));
}

const riskRules = [
  {
    code: 'RESTRICTIVE_LIST_HIT',
    name: 'Lista restritiva / CEIS',
    documentTypes: ['CPF', 'CNPJ'],
    condition: { path: 'sections.pldft.restrictiveListHits', operator: 'array_not_empty' },
    weight: 100,
    severity: 'critica',
    hardStop: true,
    minRiskLevel: 'muito_alto',
  },
  {
    code: 'SANCTIONS_HIT',
    name: 'Sanções internacionais',
    documentTypes: ['CPF', 'CNPJ'],
    condition: { path: 'sections.pldft.sanctionsHits', operator: 'array_not_empty' },
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
    condition: { path: 'sections.financial.protests', operator: 'array_not_empty' },
    weight: 25,
    severity: 'media',
    hardStop: false,
  },
  {
    code: 'ESG_SLAVE_LABOR',
    name: 'Trabalho escravo MTE',
    documentTypes: ['CPF', 'CNPJ'],
    condition: { path: 'sections.esg.slaveLabor', operator: 'truthy' },
    weight: 70,
    severity: 'critica',
    hardStop: true,
    minRiskLevel: 'muito_alto',
  },
  {
    code: 'ENVIRONMENTAL_EMBARGO',
    name: 'Embargo ambiental',
    documentTypes: ['CPF', 'CNPJ'],
    condition: { path: 'sections.esg.environmentalEmbargoes', operator: 'array_not_empty' },
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

async function main() {
  const mockProvider = loadJson('providers.mock.json');

  await prisma.provider.upsert({
    where: { slug: mockProvider.slug },
    create: {
      slug: mockProvider.slug,
      name: mockProvider.name,
      baseUrl: mockProvider.baseUrl,
      httpMethod: mockProvider.httpMethod,
      requestTemplate: mockProvider.requestTemplate,
      authType: mockProvider.authType,
      authConfigRef: mockProvider.authConfigRef ?? null,
      fieldMappings: mockProvider.fieldMappings,
      supportedTypes: mockProvider.supportedTypes,
      isActive: mockProvider.isActive,
      priority: mockProvider.priority,
    },
    update: {
      name: mockProvider.name,
      baseUrl: mockProvider.baseUrl,
      httpMethod: mockProvider.httpMethod,
      requestTemplate: mockProvider.requestTemplate,
      authType: mockProvider.authType,
      fieldMappings: mockProvider.fieldMappings,
      supportedTypes: mockProvider.supportedTypes,
      isActive: mockProvider.isActive,
      priority: mockProvider.priority,
    },
  });

  for (const rule of riskRules) {
    await prisma.riskRule.upsert({
      where: { code: rule.code },
      create: rule,
      update: rule,
    });
  }

  console.log('Seed concluído: mock-provider + risk rules');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
