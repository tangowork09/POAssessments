import { describe, expect, it } from 'vitest';
import { _testing } from '../src/worker/routes/admin.js';

const { parseCsv, csvCell } = _testing;

describe('parseCsv', () => {
  it('reads a plain header and rows', () => {
    expect(parseCsv('email,name\na@b.com,Ada')).toEqual([
      ['email', 'name'],
      ['a@b.com', 'Ada'],
    ]);
  });

  it('handles CRLF, LF and a trailing newline alike', () => {
    const expected = [
      ['a', 'b'],
      ['1', '2'],
    ];
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual(expected);
    expect(parseCsv('a,b\n1,2\n')).toEqual(expected);
    expect(parseCsv('a,b\r1,2')).toEqual(expected);
  });

  it('keeps commas inside quoted fields', () => {
    expect(parseCsv('name,org\nAda,"Bletchley, Park"')).toEqual([
      ['name', 'org'],
      ['Ada', 'Bletchley, Park'],
    ]);
  });

  it('unescapes doubled quotes', () => {
    expect(parseCsv('note\n"She said ""hello"""')).toEqual([['note'], ['She said "hello"']]);
  });

  it('keeps newlines inside quoted fields', () => {
    expect(parseCsv('a\n"line one\nline two"')).toEqual([['a'], ['line one\nline two']]);
  });

  it('drops entirely blank rows but keeps rows with any content', () => {
    expect(parseCsv('a,b\n\n1,2\n,,\n3,4')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('strips a UTF-8 BOM so the first header still matches', () => {
    expect(parseCsv('﻿email\na@b.com')[0]).toEqual(['email']);
  });

  it('preserves empty trailing fields', () => {
    expect(parseCsv('a,b,c\n1,,')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', ''],
    ]);
  });

  it('returns nothing for empty input', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('\n\n')).toEqual([]);
  });
});

describe('csvCell', () => {
  it('passes ordinary values through', () => {
    expect(csvCell('Ada')).toBe('Ada');
    expect(csvCell(42)).toBe('42');
  });

  it('renders null and undefined as empty', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('quotes anything containing a comma, quote or newline', () => {
    expect(csvCell('Bletchley, Park')).toBe('"Bletchley, Park"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('one\ntwo')).toBe('"one\ntwo"');
  });

  it('defuses spreadsheet formula injection from candidate text', () => {
    // Excel and Sheets execute a cell beginning with any of these.
    for (const payload of ['=1+1', '+1', '-1', '@SUM(A1)']) {
      expect(csvCell(payload).startsWith("'")).toBe(true);
    }
    expect(csvCell('=HYPERLINK("http://evil","click")')).toBe(
      '"\'=HYPERLINK(""http://evil"",""click"")"',
    );
  });

  it('round-trips through the parser', () => {
    const values = ['plain', 'with, comma', 'with "quote"', 'multi\nline', ''];
    const row = values.map(csvCell).join(',');
    expect(parseCsv(`h1,h2,h3,h4,h5\n${row}`)[1]).toEqual(values);
  });
});
