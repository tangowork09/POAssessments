/**
 * Reading a participant list out of the spreadsheet it already lives in.
 *
 * HR arrives with a column of fifty people, not with fifty lines to paste. A
 * tool that makes them retype it is a tool that gets used once and then worked
 * around, so this takes the file as-is: any sheet, any column order, with or
 * without a header row.
 *
 * The rule for finding columns is deliberately dumb and therefore predictable.
 * The email is whichever cell in the row contains an "@" — that is unambiguous
 * and needs no header. Name and department are then found by their headers if
 * the sheet has them, and by position if it does not.
 */

import { XlsxError, cellAt, readXlsx, sheetWidth, type XlsxSheet } from './xlsx-read.js';

export interface RosterPerson {
  email: string;
  name: string;
  department: string;
}

export interface RosterFileResult {
  people: RosterPerson[];
  /** Rows that held no address at all, reported rather than silently dropped. */
  skipped: number;
  /** Which sheet the people came from, so the facilitator can check. */
  sheet: string;
}

const NAME_HEADERS = /^(name|full ?name|participant|person|leader|employee)$/i;
const DEPT_HEADERS = /^(department|dept|function|team|area|division|business unit|bu)$/i;
const EMAIL_HEADERS = /^(e-?mail|email ?address|mail)$/i;

/** A workbook that came from a facilitator's Excel export. */
export async function readRosterFile(bytes: Uint8Array): Promise<RosterFileResult> {
  const sheets = await readXlsx(bytes);
  if (sheets.length === 0) throw new XlsxError('That workbook has no sheets in it.');

  // The sheet with the most addresses in it, because a workbook often carries
  // an instructions tab in front of the list.
  const best = sheets
    .map((sheet) => ({ sheet, count: countEmails(sheet) }))
    .sort((a, b) => b.count - a.count)[0];

  if (!best || best.count === 0) {
    throw new XlsxError(
      'No email addresses were found in that workbook. Each person needs one, in any column.',
    );
  }

  return readSheet(best.sheet);
}

function countEmails(sheet: XlsxSheet): number {
  let n = 0;
  for (const row of sheet.rows) for (const cell of row) if (looksLikeEmail(cell)) n++;
  return n;
}

function looksLikeEmail(value: string): boolean {
  const v = value.trim();
  return /^[^@\s,;]+@[^@\s,;.]+(\.[^@\s,;.]+)+$/.test(v);
}

function readSheet(sheet: XlsxSheet): RosterFileResult {
  const width = sheetWidth(sheet);
  const header = findHeaderRow(sheet, width);

  let nameCol = 0;
  let deptCol = 0;
  let emailCol = 0;
  if (header > 0) {
    for (let c = 1; c <= width; c++) {
      const label = cellAt(sheet, header, c).trim();
      if (NAME_HEADERS.test(label)) nameCol = c;
      else if (DEPT_HEADERS.test(label)) deptCol = c;
      else if (EMAIL_HEADERS.test(label)) emailCol = c;
    }
  }

  const people: RosterPerson[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  for (let r = header + 1; r <= sheet.rows.length; r++) {
    const cells: string[] = [];
    for (let c = 1; c <= width; c++) cells.push(cellAt(sheet, r, c).trim());
    if (cells.every((v) => v === '')) continue;

    // The address is whichever cell is one, whatever the header said: a column
    // labelled "Name" holding addresses is commoner than a correct header.
    const emailAt = emailCol > 0 && looksLikeEmail(cells[emailCol - 1] ?? '')
      ? emailCol - 1
      : cells.findIndex((v) => looksLikeEmail(v));
    if (emailAt < 0) {
      skipped++;
      continue;
    }

    const email = cells[emailAt]!.toLowerCase();
    if (seen.has(email)) continue;
    seen.add(email);

    const rest = cells.filter((_, i) => i !== emailAt && cells[i] !== '');
    const name = pick(cells, nameCol, emailAt) ?? rest[0] ?? '';
    const department = pick(cells, deptCol, emailAt) ?? (name === rest[0] ? (rest[1] ?? '') : '');

    people.push({ email, name: name.slice(0, 120), department: department.slice(0, 80) });
  }

  if (people.length === 0) {
    throw new XlsxError('No usable rows were found on that sheet.');
  }
  return { people, skipped, sheet: sheet.name };
}

function pick(cells: string[], col: number, emailAt: number): string | null {
  if (col <= 0 || col - 1 === emailAt) return null;
  const value = cells[col - 1];
  return value && value !== '' ? value : null;
}

/**
 * The row that names the columns, or 0 when the sheet just starts with people.
 *
 * A header row is one that names something and holds no address: the moment a
 * row contains an address it is a person, not a heading.
 */
function findHeaderRow(sheet: XlsxSheet, width: number): number {
  const limit = Math.min(sheet.rows.length, 10);
  for (let r = 1; r <= limit; r++) {
    let labels = 0;
    let hasEmail = false;
    for (let c = 1; c <= width; c++) {
      const cell = cellAt(sheet, r, c).trim();
      if (cell === '') continue;
      if (looksLikeEmail(cell)) hasEmail = true;
      if (NAME_HEADERS.test(cell) || DEPT_HEADERS.test(cell) || EMAIL_HEADERS.test(cell)) labels++;
    }
    if (!hasEmail && labels > 0) return r;
    if (hasEmail) return 0;
  }
  return 0;
}
