/**
 * One-shot: render homolog intel JSON → HTML+PDF (juridico document layout).
 * Usage: npx tsx scripts/render-homolog-pdf.ts /tmp/apollo-homolog/cpf1.json [...]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderDossierHtml } from '../../../juridico_v2/api/src/lib/dossier/document.ts';

const outDir = path.resolve('/home/thiago/Ipebank/tmp/dossiers');
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pillarsHtml(intel: {
  pillars?: Record<
    string,
    { label: string; status: string; providerCount: number; findingCount: number; error?: string }
  >;
}): string {
  const p = intel.pillars;
  if (!p) return '';
  const items = [p.bdc, p.lemit, p.brasilapi, p.extras, p.apollo].filter(Boolean);
  if (!items.length) return '';
  const rows = items
    .map(
      (item) =>
        `<tr><td>${escapeHtml(item.label)}</td><td>${escapeHtml(item.status)}</td><td>${item.providerCount}</td><td>${item.findingCount}</td><td>${escapeHtml(item.error ?? '—')}</td></tr>`,
    )
    .join('');
  return `<section class="block"><h2>Pilares do dossiê</h2><table><thead><tr><th>Pilar</th><th>Status</th><th>Fontes</th><th>Achados</th><th>Erro</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

function apolloHighlight(intel: {
  findings?: Array<{
    sourceName: string;
    category: string;
    title: string;
    summary: string;
    url?: string | null;
  }>;
}): string {
  const apollo = (intel.findings ?? []).filter((f) => /apollo/i.test(f.sourceName));
  if (!apollo.length) return '';
  const items = apollo
    .map((f) => {
      const link = f.url ? ` · <a href="${escapeHtml(f.url)}">${escapeHtml(f.url)}</a>` : '';
      const summary = f.summary ? `: ${escapeHtml(f.summary)}` : '';
      return `<li><strong>${escapeHtml(f.category)}</strong> — ${escapeHtml(f.title)}${summary}${link}</li>`;
    })
    .join('');
  return `<section class="block"><h2>Apollo.io (enriquecimento final)</h2><ul>${items}</ul></section>`;
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Usage: npx tsx scripts/render-homolog-pdf.ts <intel.json>...');
  process.exit(1);
}

for (const file of files) {
  const intel = JSON.parse(readFileSync(file, 'utf8')) as {
    id: string;
    target: string;
    targetType: string;
    legalBasis: string;
    overallScore: number | null;
    createdAt: string;
    completedAt?: string | null;
    partyName?: string | null;
    purpose?: string;
    findings: Array<{
      category: string;
      title: string;
      summary: string;
      sourceName: string;
      details: unknown;
      url?: string | null;
      verified?: boolean;
    }>;
    sources: Array<{
      name: string;
      category: string;
      reliability: string;
      status: string;
      error?: string | null;
    }>;
    pillars?: Record<
      string,
      { label: string; status: string; providerCount: number; findingCount: number; error?: string }
    >;
  };

  const htmlCore = renderDossierHtml({
    id: intel.id,
    target: intel.target,
    targetType: intel.targetType,
    legalBasis: intel.legalBasis,
    overallScore: intel.overallScore,
    startedAt: new Date(intel.createdAt),
    completedAt: intel.completedAt ? new Date(intel.completedAt) : null,
    createdBy: {
      name: 'OpCore Compliance — homolog Apollo',
      email: 'compliance@opcore.com.br',
    },
    party: { name: intel.partyName ?? intel.target, document: intel.target },
    process: null,
    purpose: (intel.purpose as 'KYC') ?? 'KYC',
    findings: intel.findings,
    sources: intel.sources,
  });

  const html = htmlCore.replace('</body>', `${pillarsHtml(intel)}${apolloHighlight(intel)}</body>`);
  const digits = intel.target.replace(/\D/g, '');
  const base = path.join(outDir, `dossie-cpf-${digits}-apollo-${stamp}`);
  writeFileSync(`${base}.html`, html);
  writeFileSync(`${base}.json`, JSON.stringify(intel, null, 2));

  const chrome = spawnSync(
    'google-chrome',
    [
      '--headless=new',
      '--disable-gpu',
      '--no-pdf-header-footer',
      `--print-to-pdf=${base}.pdf`,
      pathToFileURL(`${base}.html`).href,
    ],
    { encoding: 'utf8' },
  );
  if (chrome.status !== 0) {
    console.error(chrome.stderr || chrome.stdout);
    process.exit(1);
  }
  console.log('PDF', `${base}.pdf`);
  console.log('HTML', `${base}.html`);
}
