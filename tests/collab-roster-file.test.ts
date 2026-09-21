import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { readRosterFile } from '../src/worker/lib/collab-roster-file.js';
import { XlsxError } from '../src/worker/lib/xlsx-read.js';

/**
 * Real workbooks, built with the library a facilitator's Excel would produce.
 *
 * The point of this reader is that it survives what actually arrives: a
 * header row or none, columns in any order, an instructions tab in front of
 * the list, a blank line in the middle. Each test is one of those.
 */
async function workbook(sheets: Record<string, (string | number)[][]>): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = wb.addWorksheet(name);
    for (const row of rows) ws.addRow(row);
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

describe('reading a participant list out of a spreadsheet', () => {
  it('reads a headed sheet, in any column order', async () => {
    const bytes = await workbook({
      Sheet1: [
        ['Department', 'Email', 'Name'],
        ['Operations', 'anita@acme.test', 'Anita Rao'],
        ['R&D', 'sam@acme.test', 'Sam Iyer'],
      ],
    });
    const { people } = await readRosterFile(bytes);
    expect(people).toEqual([
      { email: 'anita@acme.test', name: 'Anita Rao', department: 'Operations' },
      { email: 'sam@acme.test', name: 'Sam Iyer', department: 'R&D' },
    ]);
  });

  it('reads a sheet with no header at all', async () => {
    const bytes = await workbook({
      Sheet1: [
        ['Anita Rao', 'anita@acme.test', 'Operations'],
        ['Sam Iyer', 'sam@acme.test', 'R&D'],
      ],
    });
    const { people } = await readRosterFile(bytes);
    expect(people.map((p) => p.email)).toEqual(['anita@acme.test', 'sam@acme.test']);
    expect(people[0]!.name).toBe('Anita Rao');
  });

  it('takes a bare column of addresses', async () => {
    const bytes = await workbook({ Sheet1: [['anita@acme.test'], ['sam@acme.test']] });
    const { people } = await readRosterFile(bytes);
    expect(people).toHaveLength(2);
    expect(people[0]!.name).toBe('');
  });

  it('picks the sheet the people are on, not the instructions tab', async () => {
    const bytes = await workbook({
      'How to use this': [['Fill in the next tab'], ['Ask your HR partner']],
      Participants: [
        ['Name', 'Email'],
        ['Anita Rao', 'anita@acme.test'],
        ['Sam Iyer', 'sam@acme.test'],
      ],
    });
    const parsed = await readRosterFile(bytes);
    expect(parsed.sheet).toBe('Participants');
    expect(parsed.people).toHaveLength(2);
  });

  it('counts rows with no address rather than dropping them quietly', async () => {
    const bytes = await workbook({
      Sheet1: [
        ['Name', 'Email'],
        ['Anita Rao', 'anita@acme.test'],
        ['Someone with no address', ''],
        ['Sam Iyer', 'sam@acme.test'],
      ],
    });
    const parsed = await readRosterFile(bytes);
    expect(parsed.people).toHaveLength(2);
    expect(parsed.skipped).toBe(1);
  });

  it('keeps one row per address, however it was cased', async () => {
    const bytes = await workbook({
      Sheet1: [['Anita@Acme.test'], ['anita@acme.test'], ['sam@acme.test']],
    });
    const { people } = await readRosterFile(bytes);
    expect(people).toHaveLength(2);
    expect(people[0]!.email).toBe('anita@acme.test');
  });

  it('skips blank rows in the middle of a list', async () => {
    const bytes = await workbook({
      Sheet1: [['anita@acme.test'], ['', ''], ['sam@acme.test']],
    });
    expect((await readRosterFile(bytes)).people).toHaveLength(2);
  });

  it('says so when a workbook holds no addresses at all', async () => {
    const bytes = await workbook({ Sheet1: [['Name', 'Department'], ['Anita', 'Operations']] });
    await expect(readRosterFile(bytes)).rejects.toThrow(XlsxError);
    await expect(readRosterFile(bytes)).rejects.toThrow(/no email addresses/i);
  });

  it('refuses something that is not a workbook', async () => {
    await expect(readRosterFile(new Uint8Array([1, 2, 3]))).rejects.toThrow(XlsxError);
  });
});
