/**
 * Reading an .xlsx, without a spreadsheet library.
 *
 * ExcelJS can write a workbook in the Workers runtime perfectly well, but the
 * SECOND `xlsx.load()` in an isolate never resolves: the request hangs until
 * the runtime kills it, and every later request to that isolate fails too. One
 * facilitator importing two cohorts in a row was enough to take an isolate
 * down. It reproduces on the same file, three times, on a cold server:
 *
 *     v-plain.xlsx  200 OK
 *     v-plain.xlsx  500 HANG
 *     v-plain.xlsx  500 HANG
 *
 * So the reading side is done here instead. An .xlsx is a ZIP of XML, the
 * runtime already decompresses deflate, and we need four files out of it —
 * the workbook's sheet list, its relationships, the shared string table and
 * the sheets themselves. Writing still goes through ExcelJS, which is not
 * affected and where the formatting work actually lives.
 *
 * Deliberately not a general spreadsheet reader: it returns cells as the text
 * a person would see, because every consumer here is reading names, functions
 * and email addresses off a grid.
 */

export class XlsxError extends Error {}

export interface XlsxSheet {
  /** The tab's name, as the workbook spells it. */
  name: string;
  /**
   * Cells as text, row-major and dense: `rows[r][c]` with '' for anything
   * blank, missing or past the end of a short row. Gaps are filled so a
   * caller can index a column without checking whether the row reached it.
   */
  rows: string[][];
}

// -------------------------------------------------------------------- zip

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_EOCD64_LOCATOR = 0x07064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

/** The last EOCD record, found by scanning back over the comment field. */
function findEocd(view: DataView): number {
  // The comment is at most 0xFFFF bytes, and the record itself is 22.
  const min = Math.max(0, view.byteLength - 0xffff - 22);
  for (let i = view.byteLength - 22; i >= min; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) return i;
  }
  throw new XlsxError('That file is not a readable .xlsx workbook. Export it as Excel and try again.');
}

function readCentralDirectory(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(view);
  let count = view.getUint16(eocd + 10, true);
  let start = view.getUint32(eocd + 16, true);

  // ZIP64, for a workbook past the 4 GB / 65 535-entry line. Excel writes it
  // rarely and never for a roster, but a truncated read of a real file would
  // be worse than an honest failure, so the locator is followed when present.
  if (count === 0xffff || start === 0xffffffff) {
    const locator = eocd - 20;
    if (locator < 0 || view.getUint32(locator, true) !== SIG_EOCD64_LOCATOR) {
      throw new XlsxError('That workbook is in a format this importer cannot read. Re-save it as .xlsx from Excel.');
    }
    const eocd64 = Number(view.getBigUint64(locator + 8, true));
    if (eocd64 < 0 || eocd64 + 56 > view.byteLength || view.getUint32(eocd64, true) !== SIG_EOCD64) {
      throw new XlsxError('That workbook is in a format this importer cannot read. Re-save it as .xlsx from Excel.');
    }
    count = Number(view.getBigUint64(eocd64 + 32, true));
    start = Number(view.getBigUint64(eocd64 + 48, true));
  }

  const decoder = new TextDecoder('utf-8');
  const entries: ZipEntry[] = [];
  let p = start;
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== SIG_CENTRAL) break;
    const method = view.getUint16(p + 10, true);
    let compressedSize = view.getUint32(p + 20, true);
    let uncompressedSize = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    let localHeaderOffset = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));

    // The ZIP64 extra field carries whichever of the three fields overflowed,
    // in that order, and only those.
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      let q = p + 46 + nameLen;
      const end = q + extraLen;
      while (q + 4 <= end) {
        const tag = view.getUint16(q, true);
        const size = view.getUint16(q + 2, true);
        if (tag === 0x0001) {
          let r = q + 4;
          if (uncompressedSize === 0xffffffff) { uncompressedSize = Number(view.getBigUint64(r, true)); r += 8; }
          if (compressedSize === 0xffffffff) { compressedSize = Number(view.getBigUint64(r, true)); r += 8; }
          if (localHeaderOffset === 0xffffffff) { localHeaderOffset = Number(view.getBigUint64(r, true)); }
          break;
        }
        q += 4 + size;
      }
    }

    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (entries.length === 0) {
    throw new XlsxError('That file is not a readable .xlsx workbook. Export it as Excel and try again.');
  }
  return entries;
}

async function inflate(raw: Uint8Array): Promise<Uint8Array> {
  // A one-shot source rather than a Blob: Blob is not guaranteed in every
  // runtime this bundle targets, and a stream of one chunk is what the
  // decompressor wants anyway.
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(raw);
      controller.close();
    },
  });
  const stream = source.pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * One entry's bytes.
 *
 * The local header is re-read rather than trusted to match the central
 * directory: its extra field is allowed to differ in length, and taking the
 * central one would start the read a few bytes into the data.
 */
async function readEntry(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const off = entry.localHeaderOffset;
  if (off + 30 > bytes.length || view.getUint32(off, true) !== SIG_LOCAL) {
    throw new XlsxError('That workbook appears to be damaged. Re-save it from Excel and try again.');
  }
  const nameLen = view.getUint16(off + 26, true);
  const extraLen = view.getUint16(off + 28, true);
  const start = off + 30 + nameLen + extraLen;
  const raw = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return raw;
  if (entry.method !== 8) {
    throw new XlsxError('That workbook uses a compression this importer cannot read. Re-save it as .xlsx from Excel.');
  }
  try {
    return await inflate(raw);
  } catch {
    throw new XlsxError('That workbook appears to be damaged. Re-save it from Excel and try again.');
  }
}

// -------------------------------------------------------------------- xml

const TEXT = new TextDecoder('utf-8');

/**
 * XML text to the characters it stands for.
 *
 * `_xHHHH_` is Excel's own escape for characters XML cannot carry, and it is
 * undone here so a name with a line break in it does not arrive as literal
 * underscores. `_x005F_` is the escape for a literal underscore sequence and
 * is unescaped first, so `_x005F_x000D_` stays the text `_x000D_`.
 */
function decodeXmlText(value: string): string {
  let out = value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
  if (out.includes('_x')) {
    out = out
      .replace(/_x005F_(x[0-9a-fA-F]{4}_)/g, '\u0000$1')
      .replace(/_x([0-9a-fA-F]{4})_/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/\u0000/g, '_');
  }
  // A line break typed into a cell is stored as CRLF. One newline is what the
  // person typed and what every consumer here wants; a stray carriage return
  // riding along inside a name is not.
  return out.includes('\r') ? out.replace(/\r\n?/g, '\n') : out;
}

/**
 * Walks `<tag …>…</tag>` and `<tag …/>` elements, giving each one's attributes
 * and inner text.
 *
 * Hand-rolled rather than one regex, because the obvious regex gets
 * self-closing tags wrong in a way that is quiet and wrong rather than loud:
 * for `<c r="A2"/><c r="B2">x</c>` an alternation over `/>` or `>` lets the
 * attribute run swallow the slash, take the `>` branch, and then match through
 * to the SECOND cell's `</c>` — so A2 eats B2 and a column silently vanishes.
 */
function eachElement(xml: string, tag: string, fn: (attrs: string, inner: string) => void): void {
  const open = new RegExp(`<${tag}\\b([^>]*)>`, 'g');
  const close = `</${tag}>`;
  let m: RegExpExecArray | null;
  while ((m = open.exec(xml)) !== null) {
    const attrs = m[1] ?? '';
    if (attrs.endsWith('/')) {
      fn(attrs.slice(0, -1), '');
      continue;
    }
    const from = open.lastIndex;
    const end = xml.indexOf(close, from);
    if (end === -1) {
      fn(attrs, xml.slice(from));
      break;
    }
    fn(attrs, xml.slice(from, end));
    open.lastIndex = end + close.length;
  }
}

/** Every `<t>` inside a fragment, joined — a shared string may be many runs. */
function textOf(fragment: string): string {
  let out = '';
  eachElement(fragment, 't', (_attrs, inner) => {
    out += decodeXmlText(inner);
  });
  return out;
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`));
  return m ? decodeXmlText(m[1]!) : null;
}

/** "AB" -> 27. Zero for anything unparseable, which the caller treats as "next". */
function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c >= 65 && c <= 90) n = n * 26 + (c - 64);
    else if (c >= 97 && c <= 122) n = n * 26 + (c - 96);
    else break;
  }
  return n;
}

function sharedStrings(xml: string): string[] {
  const out: string[] = [];
  eachElement(xml, 'si', (_attrs, inner) => out.push(textOf(inner)));
  return out;
}

/**
 * One sheet's cells as text.
 *
 * Rows and cells carry their own addresses, and Excel omits both empty rows
 * and empty cells, so positions are taken from `r` wherever it is there and
 * only fall back to "the next one along" when it is not.
 */
/**
 * Spreads a merged cell's value across the range it covers.
 *
 * The file stores the value once, in the top-left, and leaves the rest of the
 * range empty. That is faithful but useless to a reader looking down a column:
 * a heading merged across two columns would be present under one of them and
 * missing under the other, which is exactly the kind of difference that turns
 * into "the importer dropped my column".
 */
function applyMerges(xml: string, rows: string[][]): void {
  const block = xml.match(/<mergeCells\b[\s\S]*?<\/mergeCells>/);
  if (!block) return;
  for (const m of block[0].matchAll(/<mergeCell\b([^>]*)\/?>/g)) {
    const ref = attr(m[1] ?? '', 'ref');
    const range = ref?.match(/^([A-Za-z]+)(\d+):([A-Za-z]+)(\d+)$/);
    if (!range) continue;
    const c1 = columnIndex(range[1]!);
    const r1 = Number(range[2]);
    const c2 = columnIndex(range[3]!);
    const r2 = Number(range[4]);
    const value = rows[r1 - 1]?.[c1 - 1] ?? '';
    if (!value) continue;
    // Bounded: a merge over a million rows is a formatting accident, and
    // filling it would cost more than the value it carries.
    if ((r2 - r1) * (c2 - c1) > 100_000) continue;
    for (let r = r1; r <= r2; r++) {
      const row = (rows[r - 1] ??= []);
      for (let c = c1; c <= c2; c++) {
        while (row.length < c) row.push('');
        if (!row[c - 1]) row[c - 1] = value;
      }
    }
  }
}

function parseSheet(xml: string, strings: readonly string[]): string[][] {
  const rows: string[][] = [];
  let nextRow = 1;

  eachElement(xml, 'row', (rowAttrs, body) => {
    const declared = Number(attr(rowAttrs, 'r') ?? '');
    const rowNo = Number.isFinite(declared) && declared > 0 ? declared : nextRow;
    nextRow = rowNo + 1;

    const cells: string[] = [];
    let nextCol = 1;
    eachElement(body, 'c', (cellAttrs, inner) => {
      const ref = attr(cellAttrs, 'r');
      const col = ref ? columnIndex(ref) || nextCol : nextCol;
      nextCol = col + 1;

      const type = attr(cellAttrs, 't') ?? 'n';
      let text = '';
      if (type === 'inlineStr') {
        text = textOf(inner);
      } else {
        const v = inner.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/);
        const raw = v ? decodeXmlText(v[1] ?? '') : '';
        if (type === 's') {
          const idx = Number(raw);
          text = Number.isInteger(idx) && idx >= 0 && idx < strings.length ? strings[idx]! : '';
        } else if (type === 'b') {
          text = raw === '1' ? 'TRUE' : raw === '0' ? 'FALSE' : raw;
        } else if (type === 'n' && raw !== '') {
          // A number reads as the number, not as the shorthand the file
          // happens to store it in: Excel writes small values in scientific
          // notation, and "4.2858693713232476E-2" is not what anybody typed.
          const n = Number(raw);
          text = Number.isFinite(n) ? String(n) : raw;
        } else {
          // 'str', 'd' and 'e' all read as what the cell shows.
          text = raw;
        }
      }
      while (cells.length < col - 1) cells.push('');
      cells[col - 1] = text.trim();
    });

    while (rows.length < rowNo - 1) rows.push([]);
    rows[rowNo - 1] = cells;
  });

  applyMerges(xml, rows);

  // Dense, so a caller can index a column without checking the row's length.
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  for (const row of rows) while (row.length < width) row.push('');
  return rows;
}

// ------------------------------------------------------------------ public

/**
 * Every sheet in a workbook, in the order the tabs appear.
 *
 * Sheet order comes from `workbook.xml` rather than from the order the parts
 * happen to sit in the archive, because the two are not the same and the
 * importer's "first sheet" rule has to mean the first TAB.
 */
export async function readXlsx(bytes: Uint8Array): Promise<XlsxSheet[]> {
  if (bytes.length < 22) {
    throw new XlsxError('That file is not a readable .xlsx workbook. Export it as Excel and try again.');
  }
  const entries = readCentralDirectory(bytes);
  const byName = new Map(entries.map((e) => [e.name.replace(/^\/+/, ''), e]));
  const read = async (name: string): Promise<string | null> => {
    const entry = byName.get(name);
    if (!entry) return null;
    return TEXT.decode(await readEntry(bytes, entry));
  };

  const workbookXml = await read('xl/workbook.xml');
  if (!workbookXml) {
    throw new XlsxError('That file is not a readable .xlsx workbook. Export it as Excel and try again.');
  }

  // r:id -> part name, so a sheet is found by its relationship rather than by
  // guessing that the third tab lives in sheet3.xml. It often does not.
  const relsXml = (await read('xl/_rels/workbook.xml.rels')) ?? '';
  const targetOfRel = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = attr(m[1] ?? '', 'Id');
    const target = attr(m[1] ?? '', 'Target');
    if (!id || !target) continue;
    const clean = target.replace(/^\/xl\//, '').replace(/^\.\//, '');
    targetOfRel.set(id, clean.startsWith('xl/') ? clean : `xl/${clean}`);
  }

  const stringsXml = await read('xl/sharedStrings.xml');
  const strings = stringsXml ? sharedStrings(stringsXml) : [];

  const sheets: XlsxSheet[] = [];
  let fallbackIndex = 0;
  for (const m of workbookXml.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const tag = m[1] ?? '';
    const name = attr(tag, 'name') ?? `Sheet${sheets.length + 1}`;
    fallbackIndex += 1;
    const rel = attr(tag, 'r:id') ?? attr(tag, 'id');
    const part =
      (rel ? targetOfRel.get(rel) : null) ??
      // A workbook with no usable relationships still has its sheets on disk
      // under the conventional names; a client's export tool got this wrong
      // often enough to be worth surviving.
      (byName.has(`xl/worksheets/sheet${fallbackIndex}.xml`) ? `xl/worksheets/sheet${fallbackIndex}.xml` : null);
    if (!part) continue;
    const xml = await read(part);
    if (xml === null) continue;
    sheets.push({ name, rows: parseSheet(xml, strings) });
  }

  if (sheets.length === 0) throw new XlsxError('That workbook has no sheets to read.');
  return sheets;
}

/** One cell as text, or '' — the same bounds check every caller would write. */
export function cellAt(sheet: XlsxSheet, rowNo: number, colNo: number): string {
  return sheet.rows[rowNo - 1]?.[colNo - 1] ?? '';
}

/** How many columns the widest row reaches. */
export function sheetWidth(sheet: XlsxSheet): number {
  return sheet.rows.reduce((w, r) => Math.max(w, r.length), 0);
}
