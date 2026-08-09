/**
 * A small, dependency-free PDF writer.
 *
 * Why hand-rolled: @react-pdf/renderer cannot run on workerd. Its layout engine
 * is yoga-layout, which instantiates WebAssembly from bytes at runtime — an
 * operation the Workers runtime forbids — and its PDF backend drives a bundled
 * readable-stream shim that schedules timers outside an I/O context. Both were
 * confirmed by spike, not assumed. See README "PDF generation" for the detail.
 *
 * This writer covers exactly what the Enterprise report needs: base-14
 * Helvetica text with real Adobe advance widths, word wrapping, filled
 * rectangles and straight lines. No fonts are embedded, so output is small
 * (~10 KB) and generation is a few milliseconds of pure CPU.
 */

import { FIRST_CHAR, LAST_CHAR, WIDTHS, type StdFont } from './afm.js';

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** '#1A4FD6' → { r, g, b } in 0..1. Unparseable input falls back to black. */
export function hex(value: string): Rgb {
  const v = value.trim().replace('#', '');
  const full =
    v.length === 3 ? v[0]! + v[0]! + v[1]! + v[1]! + v[2]! + v[2]! : v.length === 6 ? v : '000000';
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n)) return { r: 0, g: 0, b: 0 };
  return {
    r: ((n >> 16) & 0xff) / 255,
    g: ((n >> 8) & 0xff) / 255,
    b: (n & 0xff) / 255,
  };
}

const FONT_RESOURCE: Record<StdFont, string> = {
  Helvetica: 'F1',
  'Helvetica-Bold': 'F2',
  'Helvetica-Oblique': 'F3',
  'Helvetica-BoldOblique': 'F4',
};

/**
 * Unicode code points that WinAnsiEncoding maps to a non-Latin-1 slot. Anything
 * outside this map and outside 32..255 degrades to '?' rather than producing a
 * corrupt file.
 */
const WIN_ANSI_EXTRA: Record<number, number> = {
  0x20ac: 128, // €
  0x201a: 130,
  0x0192: 131,
  0x201e: 132,
  0x2026: 133, // …
  0x2020: 134,
  0x2021: 135,
  0x02c6: 136,
  0x2030: 137,
  0x0160: 138,
  0x2039: 139,
  0x0152: 140,
  0x017d: 142,
  0x2018: 145, // ‘
  0x2019: 146, // ’
  0x201c: 147, // “
  0x201d: 148, // ”
  0x2022: 149, // •
  0x2013: 150, // –
  0x2014: 151, // —
  0x02dc: 152,
  0x2122: 153, // ™
  0x0161: 154,
  0x203a: 155,
  0x0153: 156,
  0x017e: 158,
  0x0178: 159,
};

function toWinAnsi(codePoint: number): number {
  if (codePoint >= FIRST_CHAR && codePoint <= LAST_CHAR) return codePoint;
  const mapped = WIN_ANSI_EXTRA[codePoint];
  if (mapped !== undefined) return mapped;
  return 0x3f; // '?'
}

/** Text width in points. */
export function measure(text: string, font: StdFont, size: number): number {
  const table = WIDTHS[font];
  let total = 0;
  for (const ch of text) {
    const code = toWinAnsi(ch.codePointAt(0)!);
    total += table[code - FIRST_CHAR] ?? 0;
  }
  return (total * size) / 1000;
}

/** Greedy word wrap. Words longer than maxWidth are broken character-wise. */
export function wrap(text: string, font: StdFont, size: number, maxWidth: number): string[] {
  const paragraphs = text.split('\n');
  const lines: string[] = [];

  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate, font, size) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      if (measure(word, font, size) <= maxWidth) {
        line = word;
      } else {
        // A single unbreakable token wider than the column.
        let chunk = '';
        for (const ch of word) {
          if (measure(chunk + ch, font, size) > maxWidth && chunk) {
            lines.push(chunk);
            chunk = ch;
          } else {
            chunk += ch;
          }
        }
        line = chunk;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function escapeText(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = toWinAnsi(ch.codePointAt(0)!);
    if (code === 0x28 || code === 0x29 || code === 0x5c) out += '\\' + String.fromCharCode(code);
    else if (code < 32 || code > 126) out += '\\' + code.toString(8).padStart(3, '0');
    else out += String.fromCharCode(code);
  }
  return out;
}

const fmt = (n: number): string => {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};

export interface PageSize {
  width: number;
  height: number;
}

/** A4 at 72 dpi. */
export const A4: PageSize = { width: 595.28, height: 841.89 };

class Page {
  readonly ops: string[] = [];
  constructor(readonly size: PageSize) {}
}

export class PdfDoc {
  private readonly pages: Page[] = [];
  private current: Page;
  private readonly usedFonts = new Set<StdFont>();

  constructor(
    readonly size: PageSize = A4,
    private readonly meta: { title?: string; author?: string; subject?: string } = {},
  ) {
    this.current = new Page(size);
    this.pages.push(this.current);
  }

  get pageCount(): number {
    return this.pages.length;
  }

  get pageIndex(): number {
    return this.pages.length - 1;
  }

  addPage(): void {
    this.current = new Page(this.size);
    this.pages.push(this.current);
  }

  /** Runs `fn` with drawing directed at an earlier page (used for footers). */
  onPage(index: number, fn: () => void): void {
    const saved = this.current;
    this.current = this.pages[index] ?? saved;
    try {
      fn();
    } finally {
      this.current = saved;
    }
  }

  /**
   * Draws text with `y` measured from the top of the page — the whole layout
   * layer thinks top-down, and the PDF flip happens only here.
   */
  text(
    value: string,
    x: number,
    y: number,
    opts: { font?: StdFont; size?: number; color?: Rgb | string; charSpacing?: number } = {},
  ): void {
    if (!value) return;
    const font = opts.font ?? 'Helvetica';
    const size = opts.size ?? 10;
    const color = typeof opts.color === 'string' ? hex(opts.color) : (opts.color ?? { r: 0, g: 0, b: 0 });
    this.usedFonts.add(font);
    const flippedY = this.current.size.height - y - size;
    this.current.ops.push(
      'BT',
      `${fmt(color.r)} ${fmt(color.g)} ${fmt(color.b)} rg`,
      `/${FONT_RESOURCE[font]} ${fmt(size)} Tf`,
      opts.charSpacing ? `${fmt(opts.charSpacing)} Tc` : '0 Tc',
      `1 0 0 1 ${fmt(x)} ${fmt(flippedY)} Tm`,
      `(${escapeText(value)}) Tj`,
      'ET',
    );
  }

  textRight(value: string, right: number, y: number, opts: Parameters<PdfDoc['text']>[3] = {}): void {
    const w = measure(value, opts.font ?? 'Helvetica', opts.size ?? 10);
    this.text(value, right - w, y, opts);
  }

  textCentre(value: string, centre: number, y: number, opts: Parameters<PdfDoc['text']>[3] = {}): void {
    const w = measure(value, opts.font ?? 'Helvetica', opts.size ?? 10);
    this.text(value, centre - w / 2, y, opts);
  }

  /** Wrapped paragraph; returns the y just past the last line. */
  paragraph(
    value: string,
    x: number,
    y: number,
    width: number,
    opts: { font?: StdFont; size?: number; color?: Rgb | string; leading?: number } = {},
  ): number {
    const font = opts.font ?? 'Helvetica';
    const size = opts.size ?? 10;
    const leading = opts.leading ?? size * 1.45;
    let cursor = y;
    for (const line of wrap(value, font, size, width)) {
      this.text(line, x, cursor, { font, size, color: opts.color });
      cursor += leading;
    }
    return cursor;
  }

  /** Height a paragraph would occupy, without drawing it. */
  paragraphHeight(
    value: string,
    width: number,
    opts: { font?: StdFont; size?: number; leading?: number } = {},
  ): number {
    const font = opts.font ?? 'Helvetica';
    const size = opts.size ?? 10;
    const leading = opts.leading ?? size * 1.45;
    return wrap(value, font, size, width).length * leading;
  }

  rect(x: number, y: number, w: number, h: number, color: Rgb | string): void {
    if (w <= 0 || h <= 0) return;
    const c = typeof color === 'string' ? hex(color) : color;
    const flippedY = this.current.size.height - y - h;
    this.current.ops.push(
      'q',
      `${fmt(c.r)} ${fmt(c.g)} ${fmt(c.b)} rg`,
      `${fmt(x)} ${fmt(flippedY)} ${fmt(w)} ${fmt(h)} re f`,
      'Q',
    );
  }

  /** Stroked rectangle outline. */
  strokeRect(x: number, y: number, w: number, h: number, color: Rgb | string, lineWidth = 0.6): void {
    const c = typeof color === 'string' ? hex(color) : color;
    const flippedY = this.current.size.height - y - h;
    this.current.ops.push(
      'q',
      `${fmt(c.r)} ${fmt(c.g)} ${fmt(c.b)} RG`,
      `${fmt(lineWidth)} w`,
      `${fmt(x)} ${fmt(flippedY)} ${fmt(w)} ${fmt(h)} re S`,
      'Q',
    );
  }

  line(x1: number, y1: number, x2: number, y2: number, color: Rgb | string, lineWidth = 0.6): void {
    const c = typeof color === 'string' ? hex(color) : color;
    const h = this.current.size.height;
    this.current.ops.push(
      'q',
      `${fmt(c.r)} ${fmt(c.g)} ${fmt(c.b)} RG`,
      `${fmt(lineWidth)} w`,
      `${fmt(x1)} ${fmt(h - y1)} m ${fmt(x2)} ${fmt(h - y2)} l S`,
      'Q',
    );
  }

  /** Horizontal rule across a column. */
  hr(x: number, y: number, width: number, color: Rgb | string, lineWidth = 0.6): void {
    this.line(x, y, x + width, y, color, lineWidth);
  }

  build(): Uint8Array {
    const objects: string[] = [];
    const addObject = (body: string): number => {
      objects.push(body);
      return objects.length; // 1-based object number
    };

    // Reserve 1 = catalog, 2 = pages tree.
    addObject('');
    addObject('');

    const fontObjects: Partial<Record<StdFont, number>> = {};
    // Always emit the regular and bold faces so the resource dictionary is
    // stable even for a document that happens not to use one of them.
    for (const font of new Set<StdFont>([...this.usedFonts, 'Helvetica', 'Helvetica-Bold'])) {
      fontObjects[font] = addObject(
        `<< /Type /Font /Subtype /Type1 /BaseFont /${font} /Encoding /WinAnsiEncoding >>`,
      );
    }

    const resources =
      '<< /Font << ' +
      (Object.entries(fontObjects) as [StdFont, number][])
        .map(([font, num]) => `/${FONT_RESOURCE[font]} ${num} 0 R`)
        .join(' ') +
      ' >> >>';

    const pageNumbers: number[] = [];
    for (const page of this.pages) {
      const content = page.ops.join('\n');
      const contentNum = addObject(
        `<< /Length ${byteLength(content)} >>\nstream\n${content}\nendstream`,
      );
      const pageNum = addObject(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(page.size.width)} ${fmt(page.size.height)}] ` +
          `/Resources ${resources} /Contents ${contentNum} 0 R >>`,
      );
      pageNumbers.push(pageNum);
    }

    objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
    objects[1] =
      `<< /Type /Pages /Kids [${pageNumbers.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageNumbers.length} >>`;

    const infoNum = addObject(
      '<< ' +
        (this.meta.title ? `/Title (${escapeText(this.meta.title)}) ` : '') +
        (this.meta.author ? `/Author (${escapeText(this.meta.author)}) ` : '') +
        (this.meta.subject ? `/Subject (${escapeText(this.meta.subject)}) ` : '') +
        '/Producer (Assessment Platform) >>',
    );

    // Serialise with a byte-accurate xref table.
    const parts: string[] = ['%PDF-1.7\n%\xE2\xE3\xCF\xD3\n'];
    let offset = byteLength(parts[0]!);
    const offsets: number[] = [];

    objects.forEach((body, i) => {
      const chunk = `${i + 1} 0 obj\n${body}\nendobj\n`;
      offsets.push(offset);
      offset += byteLength(chunk);
      parts.push(chunk);
    });

    const xrefStart = offset;
    let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
    xref +=
      `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoNum} 0 R >>\n` +
      `startxref\n${xrefStart}\n%%EOF\n`;
    parts.push(xref);

    return latin1Bytes(parts.join(''));
  }
}

/** The document is written entirely in Latin-1, one char == one byte. */
function byteLength(s: string): number {
  return s.length;
}

function latin1Bytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}
