import { writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { bureauConsultationsToFindings } from '../src/dossier/bureau-findings.js';
import { applyFieldMappings } from '../src/providers/provider.mapper.js';
import { flatMappedToSections } from '../src/contracts/utils/mapped-payload.util.js';

const CPF = '37740937843';
const token = process.env.BIGDATACORP_ACCESS_TOKEN!;
const tokenId = process.env.BIGDATACORP_TOKEN_ID!;

async function bdc(dataset: string) {
  const res = await fetch('https://plataforma.bigdatacorp.com.br/pessoas', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      AccessToken: token,
      TokenId: tokenId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ Datasets: dataset, q: `doc{${CPF}}`, Limit: 1 }),
  });
  return res.json();
}

const mappings: Record<string, { source: string; target: string }[]> = {
  financial_data: [
    { source: '$.Result[0].FinantialData.TotalAssets', target: 'sections.financial.totalAssets' },
    {
      source: '$.Result[0].FinantialData.IncomeEstimates',
      target: 'sections.financial.incomeEstimates',
    },
    { source: '$.Result[0].FinantialData.TaxReturns', target: 'sections.financial.taxReturns' },
  ],
  financial_risk: [
    { source: '$.Result[0].FinancialRisk.TotalAssets', target: 'sections.financial.totalAssets' },
    {
      source: '$.Result[0].FinancialRisk.EstimatedIncomeRange',
      target: 'sections.financial.estimatedIncomeRange',
    },
    {
      source: '$.Result[0].FinancialRisk.FinancialRiskScore',
      target: 'sections.financial.financialRiskScore',
    },
    {
      source: '$.Result[0].FinancialRisk.FinancialRiskLevel',
      target: 'sections.financial.financialRiskLevel',
    },
    {
      source: '$.Result[0].FinancialRisk.IsCurrentlyOnCollection',
      target: 'sections.financial.isCurrentlyOnCollection',
    },
  ],
  collections: [
    {
      source: '$.Result[0].Collections.IsCurrentlyOnCollection',
      target: 'sections.credit.collectionsPresence',
    },
    { source: '$.Result[0].Collections', target: 'sections.financial.collections' },
  ],
  occupation_data: [
    {
      source: '$.Result[0].ProfessionData.Professions',
      target: 'sections.financial.occupations',
    },
  ],
};

async function main() {
  const results = [];
  for (const dataset of Object.keys(mappings)) {
    const raw = await bdc(dataset);
    const mapped = applyFieldMappings(raw, mappings[dataset]);
    const sections = flatMappedToSections(mapped);
    results.push({ provider: `bigdatacorp-pf-${dataset}`, payload: { sections } });
    console.log(dataset, Object.keys(sections.financial ?? {}));
  }

  const financialFindings = bureauConsultationsToFindings(results, 'CPF', {
    pillarLabel: 'BigDataCorp',
    emitAbsences: true,
  }).filter((f) => f.category === 'FINANCIAL');

  console.log('financial findings', financialFindings.length);
  for (const f of financialFindings) console.log('-', f.title, '|', f.summary);

  const intelPath =
    '/home/thiago/Ipebank/tmp/dossiers/dossie-cpf-37740937843-2026-09-02T19-41-51-743Z.json';
  const intel = JSON.parse(readFileSync(intelPath, 'utf8'));
  intel.findings = [
    ...intel.findings.filter((f: { category: string }) => f.category !== 'FINANCIAL'),
    ...financialFindings.map((f, i) => ({
      id: `fin-${i}`,
      category: f.category,
      sourceName: f.sourceName,
      reliability: f.reliability,
      confidence: f.confidence,
      title: f.title,
      summary: f.summary,
      details: f.details,
      url: f.url ?? null,
      occurredAt: f.occurredAt ? new Date(f.occurredAt).toISOString() : null,
      verified: f.verified,
    })),
  ];

  const outDir = '/home/thiago/Ipebank/tmp/dossiers';
  const outJson = path.join(outDir, 'dossie-cpf-37740937843-com-financeiro.json');
  writeFileSync(outJson, JSON.stringify(intel, null, 2));

  // render via juridico document
  const { renderDossierHtml } =
    await import('../../../juridico_v2/api/src/lib/dossier/document.ts');
  const html = renderDossierHtml({
    id: intel.id,
    target: intel.target,
    targetType: intel.targetType,
    legalBasis: intel.legalBasis,
    overallScore: intel.overallScore,
    startedAt: new Date(intel.createdAt),
    completedAt: intel.completedAt ? new Date(intel.completedAt) : null,
    createdBy: { name: 'Simulação OpCore → Jurídico', email: 'compliance@opcore.com.br' },
    party: { name: intel.partyName ?? intel.target, document: intel.target },
    process: null,
    purpose: intel.purpose ?? 'KYC',
    findings: intel.findings,
    sources: intel.sources,
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = path.join(outDir, `dossie-cpf-37740937843-financeiro-${stamp}`);
  writeFileSync(`${base}.html`, html);
  const chrome = spawnSync(
    'google-chrome',
    [
      '--headless=new',
      '--disable-gpu',
      '--no-pdf-header-footer',
      `--print-to-pdf=${base}.pdf`,
      `file://${base}.html`,
    ],
    { encoding: 'utf8' },
  );
  if (chrome.status !== 0) {
    console.error(chrome.stderr);
    process.exit(1);
  }
  const matters = [...html.matchAll(/<h3>(\d+)\. ([^<]+)<\/h3>/g)].map((m) => `${m[1]}. ${m[2]}`);
  console.log('matters:', matters.join(' | '));
  console.log('HTML', `${base}.html`);
  console.log('PDF', `${base}.pdf`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
