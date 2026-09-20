import { createRequire } from 'node:module';
const require = createRequire('/Users/tango/assessment-platform/');
const ExcelJS = require('exceljs');

const OUT = '/Users/tango/Downloads';
const INK='FF14181C', MUTED='FF6B7780', LINE='FFDFE4E8', HEAD='FFF2F5F8', ACCENT='FF0B6FB4';

const PEOPLE = [
  ['Priya Rao','Marketing','priya.rao@globaltech.example'],
  ['Aarav Menon','Marketing','aarav.menon@globaltech.example'],
  ['Nisha Iyer','Engineering','nisha.iyer@globaltech.example'],
  ['Ananya Singh','Engineering','ananya.singh@globaltech.example'],
  ['Vikram Rao','Finance','vikram.rao@globaltech.example'],
  ['Karan Bose','Finance','karan.bose@globaltech.example'],
  ['Kavya Nair','Sales','kavya.nair@globaltech.example'],
  ['Yash Chawla','Sales','yash.chawla@globaltech.example'],
  ['Rohan Bhatt','Operations','rohan.bhatt@globaltech.example'],
  ['Dev Verma','Supply Chain','dev.verma@globaltech.example'],
  ['Zoya Das','Human Resources','zoya.das@globaltech.example'],
  ['Mira Saxena','Quality','mira.saxena@globaltech.example'],
];

const wb = new ExcelJS.Workbook();
wb.creator = 'PO Assessments';
wb.created = new Date();

// ------------------------------------------------------------- 1. Roster
const ws = wb.addWorksheet('Roster');
ws.getColumn(1).width = 26; ws.getColumn(2).width = 22; ws.getColumn(3).width = 38;
const lab = (a, b) => {
  const r = ws.addRow([a, b]);
  r.getCell(1).font = { bold: true, color: { argb: MUTED } };
  r.getCell(2).font = { bold: true, size: 12, color: { argb: INK } };
  return r;
};
lab('Cohort', 'GlobalTech leadership — Q4 2026');
lab('Organisation', 'GlobalTech Industries');
const head = ws.addRow(['Name', 'Function', 'Email']);
head.font = { bold: true, size: 11, color: { argb: INK } };
head.eachCell((c) => {
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD } };
  c.border = { bottom: { style: 'thin', color: { argb: LINE } } };
});
for (const p of PEOPLE) ws.addRow(p);
ws.views = [{ state: 'frozen', ySplit: 3 }];

// --------------------------------------------- 2. Who rates whom (matrix)
const as = wb.addWorksheet('Who rates whom');
const names = PEOPLE.map(([n]) => n);
as.getColumn(1).width = 22;
const ah = as.addRow(['Rater \\ rates', ...names]);
ah.font = { bold: true, size: 10, color: { argb: INK } };
ah.alignment = { textRotation: 60, vertical: 'bottom' };
ah.height = 104;
ah.eachCell((c) => { c.fill = { type:'pattern', pattern:'solid', fgColor:{argb:HEAD} }; });
names.forEach((rater, ri) => {
  const row = as.addRow([
    rater,
    ...names.map((_, ti) => {
      if (ri === ti) return '';
      // Everyone rates their own function, plus the leadership core.
      return PEOPLE[ri][1] === PEOPLE[ti][1] || ti < 4 ? 'x' : '';
    }),
  ]);
  row.getCell(1).font = { bold: true, color: { argb: INK } };
  row.eachCell((c, i) => {
    if (i > 1) c.alignment = { horizontal: 'center' };
    c.border = { bottom: { style: 'hair', color: { argb: LINE } }, right: { style: 'hair', color: { argb: LINE } } };
  });
});
for (let i = 2; i <= names.length + 1; i++) as.getColumn(i).width = 4.4;
as.views = [{ state: 'frozen', ySplit: 1 }];

// ------------------------------------------------------------ 3. Guidance
const g = wb.addWorksheet('How to use');
g.getColumn(1).width = 112;
const title = g.addRow(['One workbook — cohort, roster and who rates whom']);
title.font = { bold: true, size: 15, color: { argb: INK } };
g.addRow([]);
const LINES = [
  ['h', 'What to do'],
  ['p', 'Fill in the two sheets, save, and upload the file once under Cohorts → New cohort → import. The cohort, its roster and its rating map are all created from this single file.'],
  ['p', 'This sheet is ignored by the importer. Keep it or delete it.'],
  ['', ''],
  ['h', 'Sheet 1 — Roster'],
  ['p', '• Rows 1 and 2 name the cohort and the organisation. Leave either blank and you can type it in the console instead.'],
  ['p', '• Do NOT insert a blank row between those two rows and the Name / Function / Email header. The importer stops looking for labels at the first row that is not one, and treats that row as the header.'],
  ['p', '• The header wording decides the columns, so the order does not matter: a heading containing "name", "leader" or "person" is the name; "function", "department", "dept", "role" or "team" is the function; anything containing "mail" is the email.'],
  ['p', '• One person per row. A row with no name is skipped and reported back to you rather than silently dropped.'],
  ['p', '• Email may be left blank. That person can still be rated; they just cannot be sent their own link.'],
  ['p', '• Names must be distinct — that is how a respondent identifies themselves, and a duplicate stops the import with a message naming it.'],
  ['', ''],
  ['h', 'Sheet 2 — Who rates whom'],
  ['p', '• Optional. Delete the sheet, or leave it empty, and everyone rates everyone — which is what the instrument assumes.'],
  ['p', '• Row 1 holds the people being RATED, across. Column A holds the RATERS, down. Any non-empty cell means "this rater rates this person" — an x, a tick, a 1 or the word yes all work, because only emptiness is checked.'],
  ['p', '• The diagonal stays blank. Nobody rates themselves, and a self-rating is dropped wherever it appears.'],
  ['p', '• Names must match the Roster sheet exactly (capitals do not matter). Anything that does not match is reported back to you, never guessed at.'],
  ['p', '• A list works too, if that is easier to fill in: put the rater in column A and the people they rate in the cells beside them, one name per cell. The importer works out which of the two shapes it is looking at.'],
  ['', ''],
  ['h', 'What this file cannot set'],
  ['p', '• Tenure band and "reports to" are set per person in the Roster tab after importing.'],
  ['p', '• The rater floor and the tie threshold are cohort settings, not spreadsheet columns.'],
  ['', ''],
  ['h', 'After the upload'],
  ['p', '• The cohort lands as a DRAFT. Opening it, and issuing the link, stay deliberate acts.'],
];
for (const [kind, text] of LINES) {
  const r = g.addRow([text]);
  r.alignment = { wrapText: true, vertical: 'top' };
  if (kind === 'h') r.font = { bold: true, size: 12, color: { argb: ACCENT } };
  else r.font = { size: 11, color: { argb: text ? INK : MUTED } };
  r.height = text.length > 110 ? 44 : text.length > 60 ? 30 : 16;
}

await wb.xlsx.writeFile(`${OUT}/Sociometry-Cohort-Setup.xlsx`);
console.log('written');
