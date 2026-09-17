/**
 * Writes a cohort's current roster to an .xlsx in the shape the Roster panel's
 * upload expects.
 *
 * This exists because that upload replaces the roster: anyone missing from the
 * sheet is deactivated. Adding people therefore means uploading the people who
 * are already there plus the new ones, and typing sixty names back out by hand
 * to add one is how a roster gets damaged. Export, append, upload.
 *
 *   node scripts/export-roster.mjs <cohortId> [outfile] [--remote]
 *
 * Reads through wrangler so it works against the local database by default and
 * production with --remote.
 */

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ExcelJS = require('exceljs');

const args = process.argv.slice(2);
const remote = args.includes('--remote');
const [cohortId, outArg] = args.filter((a) => !a.startsWith('--'));

if (!cohortId) {
  console.error('usage: node scripts/export-roster.mjs <cohortId> [outfile] [--remote]');
  process.exit(1);
}

function query(sql) {
  const out = execFileSync(
    'npx',
    [
      'wrangler', 'd1', 'execute', 'assessment_platform',
      remote ? '--remote' : '--local',
      ...(remote ? ['--env', 'production'] : []),
      '--json', '--command', sql,
    ],
    { encoding: 'utf8', cwd: new URL('..', import.meta.url).pathname, stdio: ['ignore', 'pipe', 'ignore'] },
  );
  // wrangler prints a banner before the JSON on some versions.
  return JSON.parse(out.slice(out.indexOf('[')))[0].results;
}

const esc = (s) => String(s).replace(/'/g, "''");
const cohort = query(`SELECT name, organisation FROM cohorts WHERE id = '${esc(cohortId)}'`)[0];
if (!cohort) {
  console.error(`No cohort with id ${cohortId}.`);
  process.exit(1);
}

// Only the active roster: a deactivated member's position is kept for the
// ratings pointing at it, but listing them here would silently revive them.
const roster = query(
  `SELECT no, name, function, email FROM cohort_members
    WHERE cohort_id = '${esc(cohortId)}' AND active = 1 ORDER BY no`,
);

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('Roster');
ws.addRow(['Name', 'Function', 'Email']);
for (const m of roster) ws.addRow([m.name, m.function ?? '', m.email ?? '']);

ws.getRow(1).font = { bold: true };
ws.getColumn(1).width = 26;
ws.getColumn(2).width = 18;
ws.getColumn(3).width = 38;
ws.views = [{ state: 'frozen', ySplit: 1 }];

const help = wb.addWorksheet('How to use');
for (const row of [
  [`${cohort.name}${cohort.organisation ? ` — ${cohort.organisation}` : ''}`],
  [''],
  [`Exported ${new Date().toISOString().slice(0, 10)} · ${roster.length} active members`],
  [''],
  ['To add people: type them on new rows at the bottom of the "Roster" sheet, then'],
  ['upload this file in the cohort’s Roster panel.'],
  [''],
  ['Do not delete the rows that are already here. The upload replaces the roster, so'],
  ['a name missing from the sheet is removed from the group. The names already listed'],
  ['keep their position and every rating given about them.'],
]) help.addRow(row);
help.getRow(1).font = { bold: true, size: 13 };
help.getColumn(1).width = 88;

const out = outArg ?? `roster-${cohortId}.xlsx`;
await wb.xlsx.writeFile(out);
console.log(`wrote ${out} — ${roster.length} active members`);
