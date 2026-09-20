/**
 * The importer, against workbooks written the way Excel writes them.
 *
 * The fixtures here are built with ExcelJS — the library the platform still
 * uses for WRITING — so these are genuine .xlsx files with a real shared
 * string table, real relationships and real styling, not hand-assembled XML.
 * The reader is exercised through `readRosterWorkbook`, which is what the
 * upload routes call, so a pass here means the endpoint behaves.
 */
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { readRosterWorkbook } from '../src/worker/routes/cohorts.js';

type Row = (string | number | null)[];

/** One workbook, built the way a client's file would be. */
async function book(
  sheets: { name: string; rows: Row[]; style?: boolean }[],
): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name);
    for (const row of sheet.rows) ws.addRow(row);
    if (sheet.style) {
      ws.getRow(1).font = { bold: true };
      ws.getColumn(1).width = 24;
      ws.views = [{ state: 'frozen', ySplit: 1 }];
    }
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

const HEADER: Row = ['Name', 'Function', 'Email'];
const PEOPLE: Row[] = [
  ['Priya Rao', 'Marketing', 'priya@example.com'],
  ['Aarav Menon', 'Sales', 'aarav@example.com'],
  ['Nisha Iyer', 'Engineering', 'nisha@example.com'],
];

describe('the roster sheet', () => {
  it('reads a plain header-and-people sheet', async () => {
    const parsed = await readRosterWorkbook(await book([{ name: 'Sheet1', rows: [HEADER, ...PEOPLE] }]));
    expect(parsed.rows).toEqual([
      { name: 'Priya Rao', func: 'Marketing', email: 'priya@example.com' },
      { name: 'Aarav Menon', func: 'Sales', email: 'aarav@example.com' },
      { name: 'Nisha Iyer', func: 'Engineering', email: 'nisha@example.com' },
    ]);
    expect(parsed.skipped).toEqual([]);
    expect(parsed.assignments).toEqual([]);
  });

  it('takes the cohort and organisation off the label rows', async () => {
    const parsed = await readRosterWorkbook(
      await book([
        {
          name: 'Roster',
          rows: [['Cohort', 'GlobalTech leadership'], ['Organisation', 'GlobalTech Industries'], HEADER, ...PEOPLE],
        },
      ]),
    );
    expect(parsed.meta).toEqual({ name: 'GlobalTech leadership', organisation: 'GlobalTech Industries' });
    expect(parsed.rows).toHaveLength(3);
  });

  it('accepts the label value after a colon in the same cell', async () => {
    const parsed = await readRosterWorkbook(
      await book([{ name: 'Roster', rows: [['Team: Q4 leadership'], ['Company: Globex'], HEADER, ...PEOPLE] }]),
    );
    expect(parsed.meta).toEqual({ name: 'Q4 leadership', organisation: 'Globex' });
  });

  it('reads columns in any order, by their headings', async () => {
    const parsed = await readRosterWorkbook(
      await book([
        {
          name: 'Roster',
          rows: [
            ['Email address', 'Department', 'Leader name'],
            ['priya@example.com', 'Marketing', 'Priya Rao'],
          ],
        },
      ]),
    );
    expect(parsed.rows).toEqual([{ name: 'Priya Rao', func: 'Marketing', email: 'priya@example.com' }]);
  });

  it('takes the first three columns when there is no header', async () => {
    const parsed = await readRosterWorkbook(await book([{ name: 'Roster', rows: PEOPLE }]));
    expect(parsed.rows.map((r) => r.name)).toEqual(['Priya Rao', 'Aarav Menon', 'Nisha Iyer']);
  });

  it('reports a row that has details but no name, and drops a wholly empty one', async () => {
    const parsed = await readRosterWorkbook(
      await book([
        { name: 'Roster', rows: [HEADER, PEOPLE[0]!, ['', 'Finance', 'nobody@example.com'], [null, null, null], PEOPLE[1]!] },
      ]),
    );
    expect(parsed.rows.map((r) => r.name)).toEqual(['Priya Rao', 'Aarav Menon']);
    expect(parsed.skipped).toEqual(['Row 3: no name']);
  });

  it('lower-cases email and keeps names exactly as typed', async () => {
    const parsed = await readRosterWorkbook(
      await book([{ name: 'Roster', rows: [HEADER, ['  Priya  Rao ', ' Marketing ', 'Priya@Example.COM']] }]),
    );
    expect(parsed.rows[0]).toEqual({ name: 'Priya  Rao', func: 'Marketing', email: 'priya@example.com' });
  });

  it('carries accents, apostrophes and ampersands through', async () => {
    const parsed = await readRosterWorkbook(
      await book([{ name: 'Roster', rows: [HEADER, ["Zoë O'Brien", 'R&D', 'zoe@example.com']] }]),
    );
    expect(parsed.rows[0]!.name).toBe("Zoë O'Brien");
    expect(parsed.rows[0]!.func).toBe('R&D');
  });

  it('reads a person whose email cell is a mailto: hyperlink', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Roster');
    ws.addRow(HEADER);
    const row = ws.addRow(['Priya Rao', 'Marketing', null]);
    row.getCell(3).value = { text: 'priya@example.com', hyperlink: 'mailto:priya@example.com' };
    const parsed = await readRosterWorkbook(new Uint8Array(await wb.xlsx.writeBuffer()));
    expect(parsed.rows[0]!.email).toBe('priya@example.com');
  });

  it('survives styling, frozen rows and column widths', async () => {
    const parsed = await readRosterWorkbook(
      await book([{ name: 'Roster', rows: [HEADER, ...PEOPLE], style: true }]),
    );
    expect(parsed.rows).toHaveLength(3);
  });

  it('reads the same workbook repeatedly — the hang this replaced', async () => {
    const bytes = await book([{ name: 'Roster', rows: [HEADER, ...PEOPLE] }]);
    for (let i = 0; i < 20; i++) {
      const parsed = await readRosterWorkbook(bytes);
      expect(parsed.rows, `read ${i + 1}`).toHaveLength(3);
    }
  });

  it('refuses a file that is not a workbook, with a message worth showing', async () => {
    await expect(readRosterWorkbook(new TextEncoder().encode('name,function\nPriya,Marketing\n'))).rejects.toThrowError(
      /Export it as Excel/,
    );
  });
});

describe('choosing the sheets', () => {
  it('prefers a sheet named for a roster over the first tab', async () => {
    const parsed = await readRosterWorkbook(
      await book([
        { name: 'Cover', rows: [['Ignore me']] },
        { name: 'Roster', rows: [HEADER, ...PEOPLE] },
      ]),
    );
    expect(parsed.rows.map((r) => r.name)).toEqual(['Priya Rao', 'Aarav Menon', 'Nisha Iyer']);
  });

  it('skips a guidance sheet even when it comes first', async () => {
    const parsed = await readRosterWorkbook(
      await book([
        { name: 'How to use', rows: [['Fill in the next sheet']] },
        { name: 'Sheet1', rows: [HEADER, ...PEOPLE] },
      ]),
    );
    expect(parsed.rows).toHaveLength(3);
  });

  it('falls back to the first sheet when nothing is named helpfully', async () => {
    const parsed = await readRosterWorkbook(await book([{ name: 'Tabelle1', rows: [HEADER, ...PEOPLE] }]));
    expect(parsed.rows).toHaveLength(3);
  });
});

describe('the who-rates-whom sheet', () => {
  const names = ['Priya Rao', 'Aarav Menon', 'Nisha Iyer'];

  it('reads a matrix', async () => {
    const parsed = await readRosterWorkbook(
      await book([
        { name: 'Roster', rows: [HEADER, ...PEOPLE] },
        {
          name: 'Who rates whom',
          rows: [
            ['Rater \\ rates', ...names],
            ['Priya Rao', '', 'x', 'x'],
            ['Aarav Menon', 'x', '', ''],
            ['Nisha Iyer', 'x', '', ''],
          ],
        },
      ]),
    );
    expect(parsed.assignments).toEqual([
      { rater: 'Priya Rao', target: 'Aarav Menon' },
      { rater: 'Priya Rao', target: 'Nisha Iyer' },
      { rater: 'Aarav Menon', target: 'Priya Rao' },
      { rater: 'Nisha Iyer', target: 'Priya Rao' },
    ]);
  });

  it('accepts any mark in a matrix cell, not only an x', async () => {
    const parsed = await readRosterWorkbook(
      await book([
        { name: 'Roster', rows: [HEADER, ...PEOPLE] },
        {
          name: 'Assignments',
          rows: [['Rater', ...names], ['Priya Rao', '', 1, 'yes'], ['Aarav Menon', '✓', '', '']],
        },
      ]),
    );
    expect(parsed.assignments).toHaveLength(3);
  });

  it('reads a list, and skips its header row', async () => {
    const parsed = await readRosterWorkbook(
      await book([
        { name: 'Roster', rows: [HEADER, ...PEOPLE] },
        {
          name: 'Who rates whom',
          rows: [
            ['Rater', 'Rates', ''],
            ['Priya Rao', 'Aarav Menon', 'Nisha Iyer'],
            ['Nisha Iyer', 'Priya Rao', ''],
          ],
        },
      ]),
    );
    expect(parsed.assignments).toEqual([
      { rater: 'Priya Rao', target: 'Aarav Menon' },
      { rater: 'Priya Rao', target: 'Nisha Iyer' },
      { rater: 'Nisha Iyer', target: 'Priya Rao' },
    ]);
  });

  it('is absent when the workbook has no such sheet — the full matrix', async () => {
    const parsed = await readRosterWorkbook(await book([{ name: 'Roster', rows: [HEADER, ...PEOPLE] }]));
    expect(parsed.assignments).toEqual([]);
  });

  it('is absent when the sheet is there but empty', async () => {
    const parsed = await readRosterWorkbook(
      await book([
        { name: 'Roster', rows: [HEADER, ...PEOPLE] },
        { name: 'Who rates whom', rows: [] },
      ]),
    );
    expect(parsed.assignments).toEqual([]);
  });

  it('keeps names that match nothing, for the caller to report', async () => {
    const parsed = await readRosterWorkbook(
      await book([
        { name: 'Roster', rows: [HEADER, ...PEOPLE] },
        { name: 'Who rates whom', rows: [['Rater', 'Rates'], ['Priya Rao', 'Someone Else']] },
      ]),
    );
    expect(parsed.assignments).toEqual([{ rater: 'Priya Rao', target: 'Someone Else' }]);
  });

  it('does not mistake the roster itself for an assignment sheet', async () => {
    const parsed = await readRosterWorkbook(
      await book([{ name: 'Roster', rows: [HEADER, ...PEOPLE] }, { name: 'How to use', rows: [['guidance']] }]),
    );
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.assignments).toEqual([]);
  });
});

describe('workbooks a person designed rather than exported', () => {
  it('finds a table that starts below a title block and right of a spacer column', async () => {
    // The shape of the client's own instrument: empty column A, a title, a
    // note, a blank row, then the header.
    const parsed = await readRosterWorkbook(
      await book([
        {
          name: 'Roster',
          rows: [
            [],
            ['', 'Leader Roster'],
            ['', 'Replace the placeholders with the real names and functions.'],
            [],
            ['', 'No.', 'Leader name', 'Function / Department'],
            ['', 1, 'Priya Rao', 'Marketing'],
            ['', 2, 'Aarav Menon', 'Sales'],
          ],
        },
      ]),
    );
    expect(parsed.rows).toEqual([
      { name: 'Priya Rao', func: 'Marketing', email: '' },
      { name: 'Aarav Menon', func: 'Sales', email: '' },
    ]);
  });

  it('prefers the real header over a title that names a column by accident', async () => {
    const parsed = await readRosterWorkbook(
      await book([
        {
          name: 'Sheet1',
          rows: [
            ['Leader Roster'],
            ['Name', 'Function', 'Email'],
            ['Priya Rao', 'Marketing', 'priya@example.com'],
          ],
        },
      ]),
    );
    expect(parsed.rows).toEqual([{ name: 'Priya Rao', func: 'Marketing', email: 'priya@example.com' }]);
  });

  it('skips blank rows above the label rows', async () => {
    const parsed = await readRosterWorkbook(
      await book([
        { name: 'Roster', rows: [[], [], ['Cohort', 'Q4 leadership'], ['Name', 'Function'], ['Priya Rao', 'Marketing']] },
      ]),
    );
    expect(parsed.meta.name).toBe('Q4 leadership');
    expect(parsed.rows).toEqual([{ name: 'Priya Rao', func: 'Marketing', email: '' }]);
  });

  it('reads a headerless sheet that starts in column C', async () => {
    const parsed = await readRosterWorkbook(
      await book([{ name: 'Roster', rows: [['', '', 'Priya Rao', 'Marketing'], ['', '', 'Aarav Menon', 'Sales']] }]),
    );
    expect(parsed.rows.map((r) => r.name)).toEqual(['Priya Rao', 'Aarav Menon']);
    expect(parsed.rows[0]!.func).toBe('Marketing');
  });

  it('does not take a person as a header when their function reads like one', async () => {
    const parsed = await readRosterWorkbook(
      await book([{ name: 'Roster', rows: [['Priya Rao', 'Team Lead', 'priya@example.com'], ['Aarav Menon', 'Sales', 'aarav@example.com']] }]),
    );
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]!.name).toBe('Priya Rao');
  });

  it('leaves email empty when the sheet has no such column', async () => {
    const parsed = await readRosterWorkbook(
      await book([{ name: 'Roster', rows: [['Leader name', 'Department'], ['Priya Rao', 'Marketing']] }]),
    );
    expect(parsed.rows).toEqual([{ name: 'Priya Rao', func: 'Marketing', email: '' }]);
  });
});
