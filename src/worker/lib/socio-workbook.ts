/**
 * One sociometry round's raw ratings as a workbook — the long table the
 * facilitator guide asks to be consolidated (§6, step 4), for re-analysis or
 * for the neutral party the guide says should hold the raw data.
 *
 * Three sheets:
 *
 *   1. Ratings   — one row per rater × ratee × criterion, filtered to the scope.
 *   2. Criteria  — every statement exactly as it was asked, with its block.
 *   3. Read me   — what this file is, what it covers and how to handle it.
 */

import ExcelJS from 'exceljs';
import { socioCriteriaRows, type SocioExportRow, type SocioExportScope } from '../../shared/socio-export.js';

const HEAD_FILL = 'FFF1F4F8';
const HEAD_INK = 'FF0C1421';

export interface SocioWorkbookInput {
  cohortName: string;
  organisation: string;
  roundNo: number;
  roundName: string;
  scope: SocioExportScope;
  /** "Whole group", "Department: Sales", "Person: Kabir Singh (#12)". */
  scopeLabel: string;
  tieThreshold: number;
  namedRaters: boolean;
  rows: readonly SocioExportRow[];
}

export async function buildSocioWorkbook(input: SocioWorkbookInput): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'PO Assessments';
  wb.created = new Date();

  ratingsSheet(wb, input);
  criteriaSheet(wb);
  readMeSheet(wb, input);

  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

function header(ws: ExcelJS.Worksheet, cells: string[], widths: number[]): void {
  ws.addRow(cells);
  const row = ws.getRow(ws.rowCount);
  row.font = { bold: true, color: { argb: HEAD_INK } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_FILL } };
  ws.columns.forEach((col, i) => {
    col.width = widths[i] ?? 16;
  });
}

function ratingsSheet(wb: ExcelJS.Workbook, input: SocioWorkbookInput): void {
  const ws = wb.addWorksheet('Ratings', { views: [{ state: 'frozen', ySplit: 1 }] });
  header(
    ws,
    input.namedRaters
      ? ['Round', 'Rater no', 'Rater name', 'Rater function', 'Ratee no', 'Ratee name', 'Ratee function', 'Item no', 'Criterion', 'Block', 'Score (1–5)', 'Submitted at']
      : ['Round', 'Rater', 'Rater function', 'Ratee no', 'Ratee name', 'Ratee function', 'Item no', 'Criterion', 'Block', 'Score (1–5)'],
    input.namedRaters ? [8, 9, 22, 18, 9, 22, 18, 8, 24, 16, 11, 20] : [8, 12, 18, 9, 22, 18, 8, 24, 16, 11],
  );
  for (const r of input.rows) {
    ws.addRow(
      input.namedRaters
        ? [r.round, r.raterNo, r.raterName, r.raterFunc, r.rateeNo, r.rateeName, r.rateeFunc, r.itemNo, r.criterion, r.block, r.score, r.submittedAt]
        : [r.round, r.raterName, r.raterFunc, r.rateeNo, r.rateeName, r.rateeFunc, r.itemNo, r.criterion, r.block, r.score],
    );
  }
  if (input.rows.length > 0) {
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: input.namedRaters ? 12 : 10 } };
  }
}

function criteriaSheet(wb: ExcelJS.Workbook): void {
  const ws = wb.addWorksheet('Criteria');
  header(ws, ['Item no', 'Criterion', 'Statement (rated 1–5)', 'Block', 'Polarity'], [8, 24, 90, 16, 34]);
  for (const c of socioCriteriaRows()) {
    ws.addRow([c.itemNo, c.short, c.text, c.block, c.polarity]);
  }
  ws.getColumn(3).alignment = { wrapText: true, vertical: 'top' };
}

function readMeSheet(wb: ExcelJS.Workbook, input: SocioWorkbookInput): void {
  const ws = wb.addWorksheet('Read me');
  ws.getColumn(1).width = 22;
  ws.getColumn(2).width = 100;
  const lines: [string, string | number][] = [
    ['Cohort', input.cohortName],
    ['Organisation', input.organisation],
    ['Round', `${input.roundName} (round ${input.roundNo})`],
    ['Scope', input.scopeLabel],
    ['Generated at', new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC'],
    ['Tie threshold', `${input.tieThreshold} — a rating at or above this counts as a tie in the console`],
    ['Rows', input.rows.length],
    [
      'Rater identity',
      input.namedRaters
        ? 'Named. Rater names are included because this export was taken by a full administrator.'
        : 'Pseudonymised. Raters appear as "Rater NN", numbered in a shuffled order that is different on every download and unrelated to the roster; rater numbers and submission times are left out. Names are only exported to full administrators.',
    ],
    [
      'How to read it',
      'One row per rater × ratee × criterion. Only submitted responses are included; blanks (a colleague the rater did not rate) are absent, not zero. Self-ratings are never exported. Item 12 is a deficit: a high score means the rater wants more support.',
    ],
    [
      'Confidentiality',
      'Named relational data. Individual responses are seen only by the facilitators running this exercise and are never shown to other participants. Report only patterns, never who said what about whom. Do not forward this file.',
    ],
  ];
  for (const [k, v] of lines) {
    const row = ws.addRow([k, v]);
    row.getCell(1).font = { bold: true, color: { argb: HEAD_INK } };
    row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
  }
}
