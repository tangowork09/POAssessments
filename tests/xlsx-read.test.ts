/**
 * The xlsx reader, against the shapes real workbooks actually arrive in.
 *
 * Two kinds of case here. The first is what Excel, Numbers, LibreOffice and
 * Google Sheets each do differently — shared versus inline strings, sparse
 * rows, cells out of order, sheet parts that do not match their tab order.
 * The second is what a hostile or broken file does, because this runs on an
 * upload endpoint and "throws a message the operator can act on" is part of
 * the contract.
 *
 * Fixtures are built here rather than committed as binaries so that what is
 * being tested is legible: every one of them says in code what makes it odd.
 */
import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { readXlsx, XlsxError, cellAt, sheetWidth } from '../src/worker/lib/xlsx-read.js';

// ------------------------------------------------------------ zip building

interface Part {
  name: string;
  data: string | Uint8Array;
  /** 0 stored, 8 deflate. Real workbooks use both. */
  method?: 0 | 8;
}

const enc = (s: string) => new TextEncoder().encode(s);

/** A minimal but standards-correct zip, so the reader is not tested against its own assumptions. */
function zip(parts: readonly Part[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const part of parts) {
    const nameBytes = enc(part.name);
    const raw = typeof part.data === 'string' ? enc(part.data) : part.data;
    const method = part.method ?? 8;
    const body = method === 8 ? new Uint8Array(deflateRawSync(raw)) : raw;

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, method, true);
    lv.setUint32(14, 0, true); // crc — never read
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, method, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);

    chunks.push(local, body);
    central.push(cd);
    offset += local.length + body.length;
  }

  const cdStart = offset;
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, parts.length, true);
  ev.setUint16(10, parts.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdStart, true);

  const all = [...chunks, ...central, eocd];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

// --------------------------------------------------------- workbook building

interface SheetSpec {
  name: string;
  /** Raw <sheetData> contents, so a test can be as odd as it likes. */
  xml: string;
  /** The part name, when a test needs it to disagree with tab order. */
  part?: string;
}

function workbook(sheets: readonly SheetSpec[], opts: { strings?: readonly string[]; rels?: boolean } = {}): Uint8Array {
  const parts: Part[] = [];
  const sheetTags: string[] = [];
  const relTags: string[] = [];

  sheets.forEach((s, i) => {
    const part = s.part ?? `worksheets/sheet${i + 1}.xml`;
    sheetTags.push(`<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`);
    relTags.push(`<Relationship Id="rId${i + 1}" Type="http://purl.oclc.org/ooxml/officeDocument/relationships/worksheet" Target="${part}"/>`);
    parts.push({
      name: `xl/${part}`,
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${s.xml}</sheetData></worksheet>`,
    });
  });

  parts.unshift({
    name: 'xl/workbook.xml',
    data: `<?xml version="1.0"?><workbook><sheets>${sheetTags.join('')}</sheets></workbook>`,
  });
  if (opts.rels !== false) {
    parts.push({
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0"?><Relationships>${relTags.join('')}</Relationships>`,
    });
  }
  if (opts.strings) {
    const items = opts.strings.map((t) => `<si><t>${t}</t></si>`).join('');
    parts.push({ name: 'xl/sharedStrings.xml', data: `<?xml version="1.0"?><sst count="${opts.strings.length}">${items}</sst>` });
  }
  parts.push({ name: '[Content_Types].xml', data: '<?xml version="1.0"?><Types/>' });
  return zip(parts);
}

/** The ordinary case: a header and two people, as shared strings. */
function simpleBook(): Uint8Array {
  return workbook(
    [
      {
        name: 'Roster',
        xml:
          '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
          '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row>' +
          '<row r="3"><c r="A3" t="s"><v>4</v></c><c r="B3" t="s"><v>5</v></c></row>',
      },
    ],
    { strings: ['Name', 'Function', 'Priya Rao', 'Marketing', 'Aarav Menon', 'Sales'] },
  );
}

describe('the ordinary workbook', () => {
  it('reads sheet names and cells', async () => {
    const [sheet] = await readXlsx(simpleBook());
    expect(sheet!.name).toBe('Roster');
    expect(sheet!.rows[0]).toEqual(['Name', 'Function']);
    expect(sheet!.rows[1]).toEqual(['Priya Rao', 'Marketing']);
    expect(cellAt(sheet!, 3, 1)).toBe('Aarav Menon');
    expect(sheetWidth(sheet!)).toBe(2);
  });

  // The bug this module exists for: ExcelJS hung on the second load in an
  // isolate, and every request after it failed.
  it('reads the same workbook many times over', async () => {
    const bytes = simpleBook();
    for (let i = 0; i < 25; i++) {
      const [sheet] = await readXlsx(bytes);
      expect(cellAt(sheet!, 2, 1), `read ${i + 1}`).toBe('Priya Rao');
    }
  });

  it('reads different workbooks in sequence', async () => {
    for (let i = 0; i < 10; i++) {
      const book = workbook([{ name: `S${i}`, xml: `<row r="1"><c r="A1" t="inlineStr"><is><t>v${i}</t></is></c></row>` }]);
      const [sheet] = await readXlsx(book);
      expect(cellAt(sheet!, 1, 1)).toBe(`v${i}`);
    }
  });
});

describe('cell types', () => {
  it('reads inline strings, numbers, booleans, formula results and dates', async () => {
    const [sheet] = await readXlsx(
      workbook([
        {
          name: 'Types',
          xml:
            '<row r="1">' +
            '<c r="A1" t="inlineStr"><is><t>Inline</t></is></c>' +
            '<c r="B1"><v>42</v></c>' +
            '<c r="C1" t="b"><v>1</v></c>' +
            '<c r="D1" t="b"><v>0</v></c>' +
            '<c r="E1" t="str"><f>CONCAT("a","b")</f><v>ab</v></c>' +
            '<c r="F1" t="d"><v>2026-09-20T00:00:00</v></c>' +
            '<c r="G1" t="e"><v>#REF!</v></c>' +
            '</row>',
        },
      ]),
    );
    expect(sheet!.rows[0]).toEqual(['Inline', '42', 'TRUE', 'FALSE', 'ab', '2026-09-20T00:00:00', '#REF!']);
  });

  it('joins the runs of a rich-text shared string', async () => {
    const parts = workbook([{ name: 'S', xml: '<row r="1"><c r="A1" t="s"><v>0</v></c></row>' }]);
    // Rebuild with a multi-run <si>, which is what bold-in-the-middle produces.
    const rich = new TextDecoder().decode(parts).includes('sharedStrings');
    expect(rich).toBe(false); // the helper only writes simple ones
    const book = zip([
      { name: 'xl/workbook.xml', data: '<?xml version="1.0"?><workbook><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>' },
      { name: 'xl/sharedStrings.xml', data: '<?xml version="1.0"?><sst><si><r><t>Priya</t></r><r><t xml:space="preserve"> Rao</t></r></si></sst>' },
      { name: 'xl/worksheets/sheet1.xml', data: '<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>' },
    ]);
    const [sheet] = await readXlsx(book);
    expect(cellAt(sheet!, 1, 1)).toBe('Priya Rao');
  });

  it('decodes entities and Excel’s own _xHHHH_ escapes', async () => {
    const book = zip([
      { name: 'xl/workbook.xml', data: '<?xml version="1.0"?><workbook><sheets><sheet name="R&amp;D" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>' },
      {
        name: 'xl/sharedStrings.xml',
        data:
          '<?xml version="1.0"?><sst>' +
          '<si><t>Ben &amp; Jerry&apos;s</t></si>' +
          '<si><t>&#x4E2D;&#25991;</t></si>' +
          '<si><t>line_x000D_\nbreak</t></si>' +
          '<si><t>_x005F_x000D_ literal</t></si>' +
          '</sst>',
      },
      {
        name: 'xl/worksheets/sheet1.xml',
        data:
          '<?xml version="1.0"?><worksheet><sheetData><row r="1">' +
          '<c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c>' +
          '<c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c>' +
          '</row></sheetData></worksheet>',
      },
    ]);
    const [sheet] = await readXlsx(book);
    expect(sheet!.name).toBe('R&D');
    expect(cellAt(sheet!, 1, 1)).toBe("Ben & Jerry's");
    expect(cellAt(sheet!, 1, 2)).toBe('中文');
    // CRLF, as a typed line break is stored, arrives as one newline.
    expect(cellAt(sheet!, 1, 3)).toBe('line\nbreak');
    expect(cellAt(sheet!, 1, 4)).toBe('_x000D_ literal');
  });

  it('trims the padding a hand-filled sheet arrives with', async () => {
    const [sheet] = await readXlsx(
      workbook([{ name: 'S', xml: '<row r="1"><c r="A1" t="inlineStr"><is><t xml:space="preserve">  Priya Rao  </t></is></c></row>' }]),
    );
    expect(cellAt(sheet!, 1, 1)).toBe('Priya Rao');
  });
});

describe('the shapes a sheet arrives in', () => {
  it('keeps positions when rows and cells are sparse', async () => {
    // Row 2 missing entirely; row 3 starts at column C.
    const [sheet] = await readXlsx(
      workbook([
        {
          name: 'S',
          xml:
            '<row r="1"><c r="A1" t="inlineStr"><is><t>a1</t></is></c></row>' +
            '<row r="3"><c r="C3" t="inlineStr"><is><t>c3</t></is></c></row>',
        },
      ]),
    );
    expect(cellAt(sheet!, 1, 1)).toBe('a1');
    expect(cellAt(sheet!, 2, 1)).toBe('');
    expect(cellAt(sheet!, 3, 1)).toBe('');
    expect(cellAt(sheet!, 3, 3)).toBe('c3');
    expect(sheet!.rows).toHaveLength(3);
  });

  it('reads cells given out of order, and past column Z', async () => {
    const [sheet] = await readXlsx(
      workbook([
        {
          name: 'S',
          xml:
            '<row r="1">' +
            '<c r="AB1" t="inlineStr"><is><t>ab</t></is></c>' +
            '<c r="A1" t="inlineStr"><is><t>a</t></is></c>' +
            '<c r="AA1" t="inlineStr"><is><t>aa</t></is></c>' +
            '</row>',
        },
      ]),
    );
    expect(cellAt(sheet!, 1, 1)).toBe('a');
    expect(cellAt(sheet!, 1, 27)).toBe('aa');
    expect(cellAt(sheet!, 1, 28)).toBe('ab');
  });

  it('falls back to position when a row or cell carries no address', async () => {
    const [sheet] = await readXlsx(
      workbook([
        {
          name: 'S',
          xml:
            '<row><c t="inlineStr"><is><t>one</t></is></c><c t="inlineStr"><is><t>two</t></is></c></row>' +
            '<row><c t="inlineStr"><is><t>three</t></is></c></row>',
        },
      ]),
    );
    expect(sheet!.rows[0]).toEqual(['one', 'two']);
    expect(sheet!.rows[1]![0]).toBe('three');
  });

  it('handles empty rows, empty cells and a wholly empty sheet', async () => {
    const [sheet] = await readXlsx(
      workbook([{ name: 'S', xml: '<row r="1"/><row r="2"><c r="A2"/><c r="B2" t="inlineStr"><is><t>x</t></is></c></row>' }]),
    );
    expect(cellAt(sheet!, 2, 2)).toBe('x');
    const [empty] = await readXlsx(workbook([{ name: 'Blank', xml: '' }]));
    expect(empty!.rows).toEqual([]);
    expect(sheetWidth(empty!)).toBe(0);
  });

  it('pads every row to the width of the widest', async () => {
    const [sheet] = await readXlsx(
      workbook([
        {
          name: 'S',
          xml:
            '<row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c><c r="D1" t="inlineStr"><is><t>d</t></is></c></row>' +
            '<row r="2"><c r="A2" t="inlineStr"><is><t>a2</t></is></c></row>',
        },
      ]),
    );
    expect(sheet!.rows[1]).toHaveLength(4);
    expect(sheet!.rows[1]).toEqual(['a2', '', '', '']);
  });
});

describe('the workbook around the sheets', () => {
  it('returns sheets in tab order, not archive order', async () => {
    const book = workbook([
      { name: 'Roster', xml: '<row r="1"><c r="A1" t="inlineStr"><is><t>r</t></is></c></row>', part: 'worksheets/sheet7.xml' },
      { name: 'Who rates whom', xml: '<row r="1"><c r="A1" t="inlineStr"><is><t>w</t></is></c></row>', part: 'worksheets/sheet2.xml' },
    ]);
    const sheets = await readXlsx(book);
    expect(sheets.map((s) => s.name)).toEqual(['Roster', 'Who rates whom']);
    expect(cellAt(sheets[0]!, 1, 1)).toBe('r');
    expect(cellAt(sheets[1]!, 1, 1)).toBe('w');
  });

  it('still finds the sheets when the relationships are missing', async () => {
    const book = workbook(
      [
        { name: 'One', xml: '<row r="1"><c r="A1" t="inlineStr"><is><t>1</t></is></c></row>' },
        { name: 'Two', xml: '<row r="1"><c r="A1" t="inlineStr"><is><t>2</t></is></c></row>' },
      ],
      { rels: false },
    );
    const sheets = await readXlsx(book);
    expect(sheets.map((s) => s.name)).toEqual(['One', 'Two']);
    expect(cellAt(sheets[1]!, 1, 1)).toBe('2');
  });

  it('reads a workbook with no shared string table', async () => {
    const [sheet] = await readXlsx(workbook([{ name: 'S', xml: '<row r="1"><c r="A1"><v>7</v></c></row>' }]));
    expect(cellAt(sheet!, 1, 1)).toBe('7');
  });

  it('reads stored (uncompressed) parts', async () => {
    const book = zip([
      { name: 'xl/workbook.xml', data: '<?xml version="1.0"?><workbook><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>', method: 0 },
      { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>', method: 0 },
      { name: 'xl/worksheets/sheet1.xml', data: '<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>stored</t></is></c></row></sheetData></worksheet>', method: 0 },
    ]);
    const [sheet] = await readXlsx(book);
    expect(cellAt(sheet!, 1, 1)).toBe('stored');
  });

  it('accepts a target written as ./ or /xl/', async () => {
    const book = zip([
      { name: 'xl/workbook.xml', data: '<?xml version="1.0"?><workbook><sheets><sheet name="A" sheetId="1" r:id="rId1"/><sheet name="B" sheetId="2" r:id="rId2"/></sheets></workbook>' },
      {
        name: 'xl/_rels/workbook.xml.rels',
        data:
          '<?xml version="1.0"?><Relationships>' +
          '<Relationship Id="rId1" Target="/xl/worksheets/sheet1.xml"/>' +
          '<Relationship Id="rId2" Target="./worksheets/sheet2.xml"/>' +
          '</Relationships>',
      },
      { name: 'xl/worksheets/sheet1.xml', data: '<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>one</t></is></c></row></sheetData></worksheet>' },
      { name: 'xl/worksheets/sheet2.xml', data: '<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>two</t></is></c></row></sheetData></worksheet>' },
    ]);
    const sheets = await readXlsx(book);
    expect(sheets.map((s) => cellAt(s, 1, 1))).toEqual(['one', 'two']);
  });

  it('carries a big sheet without losing rows', async () => {
    const rows = Array.from(
      { length: 2000 },
      (_, i) => `<row r="${i + 1}"><c r="A${i + 1}" t="inlineStr"><is><t>p${i}</t></is></c></row>`,
    ).join('');
    const [sheet] = await readXlsx(workbook([{ name: 'Big', xml: rows }]));
    expect(sheet!.rows).toHaveLength(2000);
    expect(cellAt(sheet!, 2000, 1)).toBe('p1999');
  });
});

describe('files that are not workbooks', () => {
  const message = /readable \.xlsx|damaged|no sheets|cannot read/i;

  it('rejects an empty file', async () => {
    await expect(readXlsx(new Uint8Array(0))).rejects.toBeInstanceOf(XlsxError);
  });

  it('rejects a PDF, a CSV and random bytes', async () => {
    for (const bytes of [enc('%PDF-1.7\n%âãÏÓ\n'), enc('name,function\nPriya,Marketing\n'), new Uint8Array(400).fill(0xab)]) {
      await expect(readXlsx(bytes), 'not a zip').rejects.toThrowError(message);
    }
  });

  it('rejects a zip that is not a workbook', async () => {
    const notXlsx = zip([{ name: 'readme.txt', data: 'hello' }]);
    await expect(readXlsx(notXlsx)).rejects.toThrowError(message);
  });

  it('rejects a workbook whose sheet parts are missing', async () => {
    const book = zip([
      { name: 'xl/workbook.xml', data: '<?xml version="1.0"?><workbook><sheets><sheet name="Gone" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>' },
    ]);
    await expect(readXlsx(book)).rejects.toThrowError(/no sheets/i);
  });

  it('rejects a truncated archive rather than reading half of it', async () => {
    const good = simpleBook();
    // Keep the directory, lose the data the entries point at.
    const broken = good.slice();
    broken.fill(0, 40, 120);
    await expect(readXlsx(broken)).rejects.toBeInstanceOf(XlsxError);
  });

  it('gives a message an operator can act on, never a stack trace', async () => {
    try {
      await readXlsx(enc('nonsense'));
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(XlsxError);
      expect((err as Error).message).toMatch(/Export it as Excel|Re-save it/);
    }
  });
});
