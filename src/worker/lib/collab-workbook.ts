/**
 * A run's results as a workbook.
 *
 * What a facilitator does with a diagnostic after the debrief is argue with it:
 * re-cut a department, check whether an item that reads badly is one people
 * actually disagreed about, paste a section into a slide. So the export is not
 * a picture of the screen — it is the numbers, in the order the master copy
 * presents them, with the working shown.
 *
 * Four sheets, and the order matters:
 *
 *   1. Summary      — the index, its band, and the six sections ranked.
 *   2. Statements   — all 24 with mean, spread, both tails and the raw counts.
 *   3. By segment   — the cuts, with suppressed rows kept and marked.
 *   4. Method       — how the conversion works and what the bands mean.
 *
 * The method sheet is not filler. These numbers get forwarded to people who
 * were not at the debrief, and a column headed "mean 2.54" with no explanation
 * that fourteen statements were reversed is a number waiting to be misread.
 */

import ExcelJS from 'exceljs';
import { COLLAB_ITEM_BY_NO, COLLAB_SECTION_BY_KEY } from '../../shared/collab.js';
import { COLLAB_BANDS } from '../../shared/collab-scoring.js';
import type { CollabRunScores } from './collab-run.js';

const HEAD_FILL = 'FFF1F4F8';
const HEAD_INK = 'FF0C1421';

export interface CollabWorkbookInput {
  runName: string;
  organisation: string;
  waveNo: number;
  waveName: string;
  anonymous: boolean;
  minSegment: number;
  scores: CollabRunScores;
}

export async function buildCollabWorkbook(input: CollabWorkbookInput): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'PO Assessments';
  wb.created = new Date();

  summarySheet(wb, input);
  statementsSheet(wb, input);
  segmentSheet(wb, input);
  methodSheet(wb, input);

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

function summarySheet(wb: ExcelJS.Workbook, input: CollabWorkbookInput): void {
  const { scores } = input;
  const ws = wb.addWorksheet('Summary');

  ws.addRow([input.runName]).font = { bold: true, size: 14 };
  ws.addRow([input.organisation]);
  ws.addRow([input.waveName]);
  ws.addRow([input.anonymous ? 'Anonymous responses' : 'Named responses']);
  ws.addRow([]);

  ws.addRow(['Responses scored', scores.group.n]);
  if (scores.group.incomplete > 0) ws.addRow(['Unfinished sheets left out', scores.group.incomplete]);
  // A run on one shared link has no denominator, so it is not given a rate.
  if (scores.turnout.invited > 0) {
    ws.addRow(['Invited', scores.turnout.invited]);
    ws.addRow(['Response rate', `${Math.round((scores.turnout.completed / scores.turnout.invited) * 100)}%`]);
  } else {
    ws.addRow(['Invited', 'Answered through a shared link, so there is no invited total']);
  }
  ws.addRow([]);
  ws.addRow(['Total index (24-120)', scores.group.total]);
  ws.addRow(['Average per statement (1-5)', scores.group.perItem]);
  ws.addRow(['Band', scores.group.band.name]);
  ws.addRow(['What that suggests', scores.group.band.reading]);
  ws.addRow([]);

  header(ws, ['Section', 'Mean (1-5)', 'Spread', 'Rank'], [30, 14, 12, 8]);
  const ranked = [...scores.group.sections].sort((a, b) => b.mean - a.mean);
  ranked.forEach((section, i) => {
    ws.addRow([section.short, section.mean, section.spread ?? 'n/a', i + 1]);
  });

  ws.addRow([]);
  const strongest = ranked[0];
  const weakest = ranked[ranked.length - 1];
  if (strongest && weakest) {
    ws.addRow([
      'Strongest to weakest gap',
      scores.group.gap.value,
      `${strongest.short} → ${weakest.short}`,
    ]);
  }
}

function statementsSheet(wb: ExcelJS.Workbook, input: CollabWorkbookInput): void {
  const ws = wb.addWorksheet('Statements', { views: [{ state: 'frozen', ySplit: 1 }] });
  header(
    ws,
    [
      '#',
      'Statement',
      'Section',
      'Scored',
      'Mean (converted)',
      'Spread',
      '% at 1-2',
      '% at 4-5',
      'Split opinion',
      'Answers at 1',
      'at 2',
      'at 3',
      'at 4',
      'at 5',
    ],
    [5, 70, 24, 10, 16, 10, 10, 10, 13, 12, 8, 8, 8, 8],
  );

  for (const item of input.scores.group.items) {
    const statement = COLLAB_ITEM_BY_NO.get(item.no);
    ws.addRow([
      item.no,
      statement?.text ?? '',
      COLLAB_SECTION_BY_KEY.get(item.sectionKey)?.short ?? '',
      statement?.direction === 'reverse' ? 'Reverse (6 − answer)' : 'Direct',
      item.mean,
      item.sd ?? 'n/a',
      Math.round(item.lowShare * 100),
      Math.round(item.highShare * 100),
      item.split ? 'Yes' : '',
      ...item.counts,
    ]);
  }
  ws.getColumn(2).alignment = { wrapText: true, vertical: 'top' };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 14 } };
}

function segmentSheet(wb: ExcelJS.Workbook, input: CollabWorkbookInput): void {
  const { scores } = input;
  const ws = wb.addWorksheet('By segment');
  const sections = scores.group.sections;

  if (scores.cuts.length === 0) {
    ws.addRow(['This run collected no cuts, so its results cannot be broken down.']);
    return;
  }

  for (const cut of scores.cuts) {
    ws.addRow([cut.label]).font = { bold: true, size: 12 };
    header(
      ws,
      [cut.label, 'Respondents', 'Average per statement', ...sections.map((s) => s.short)],
      [26, 13, 20, ...sections.map(() => 18)],
    );

    for (const segment of cut.segments) {
      if (segment.suppressed) {
        // The row stays, with its count and the reason. A blank line reads as
        // "no data"; this is a rule, and the reader has to see it applied.
        ws.addRow([
          segment.name,
          segment.n,
          segment.n === 0
            ? 'Nobody from here answered'
            : `Not reported — under the floor of ${input.minSegment}`,
        ]);
        continue;
      }
      ws.addRow([
        segment.name,
        segment.n,
        segment.perItem ?? '',
        ...sections.map((s) => segment.sections?.find((x) => x.key === s.key)?.mean ?? ''),
      ]);
    }
    ws.addRow([]);
  }
}

function methodSheet(wb: ExcelJS.Workbook, input: CollabWorkbookInput): void {
  const ws = wb.addWorksheet('Method');
  ws.getColumn(1).width = 26;
  ws.getColumn(2).width = 96;
  ws.getColumn(2).alignment = { wrapText: true, vertical: 'top' };

  const lines: [string, string][] = [
    [
      'What this measures',
      'The Collaboration Diagnostic asks around fifty leaders the same 24 statements about the organisation they work in. Nobody is assessed by it; the collaboration system is. A figure here only means something across the whole group.',
    ],
    [
      'Direct and reverse',
      'Ten statements are worded as good practice and are scored as answered. Fourteen are worded as problems and are converted with 6 minus the answer, so that after conversion a 5 always means healthy whichever way the statement was worded. Every mean in this workbook is of converted scores.',
    ],
    [
      'Spread',
      'The standard deviation across respondents. Read it beside the mean: an item where half the group strongly agrees and half strongly disagrees has the same mean as one everybody is lukewarm about, and means something entirely different.',
    ],
    [
      'Split opinion',
      'Flagged where at least 30% of answers sit at each end of the converted scale. It usually marks a barrier one set of functions feels sharply and another cannot see.',
    ],
    [
      'The floor',
      input.minSegment <= 1
        ? 'Every segment is reported however small, which is what this run was set to do and what its respondents were told. A segment of one or two people should be read as those people rather than as a department.'
        : `Segments with fewer than ${input.minSegment} respondents are not reported. At that size an average is close enough to a quotation to identify who said what, which would break the confidentiality the diagnostic was answered under.`,
    ],
    [
      'The bands',
      COLLAB_BANDS.map((b) => `${b.minTotal}–${b.maxTotal}: ${b.reading}`).join('\n'),
    ],
    [
      'A caution',
      'The bands are an indicative guide, not a hard cut-off, and around fifty respondents is a small sample. Report the number answering beside any figure that leaves this file.',
    ],
    ['Source', `${input.runName} · ${input.organisation} · ${input.waveName}`],
    ['Exported', new Date().toISOString().slice(0, 10)],
  ];

  header(ws, ['', 'Method'], [26, 96]);
  for (const [label, text] of lines) {
    const row = ws.addRow([label, text]);
    row.getCell(1).font = { bold: true };
  }
}
