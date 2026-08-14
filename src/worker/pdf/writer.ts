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
 *
 * The one raster it can carry is an image XObject, used for a tenant's
 * uploaded logo. Decoding lives in `./image.ts`; this file only writes the
 * object and the placement operator.
 */

import { FIRST_CHAR, LAST_CHAR, WIDTHS, type StdFont } from './afm.js';
import type { EmbeddedImage } from './image.js';

export type { StdFont } from './afm.js';

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

/**
 * A string for the document information dictionary, not for a content stream.
 *
 * `escapeText` folds to WinAnsi because that is the encoding the page fonts
 * declare — but a literal string outside a content stream is read as
 * PDFDocEncoding, whose upper half disagrees. An em dash is 0x97 in WinAnsi and
 * Scaron in PDFDocEncoding, so "Inventory — Priya Sharma" reached the title bar
 * as "Inventory Š Priya Sharma", and any candidate whose name carries an accent
 * was mangled the same way.
 *
 * Anything outside printable ASCII therefore goes out as a UTF-16BE hex string
 * with the byte-order mark that marks it as Unicode; plain ASCII stays a
 * literal so the file remains readable.
 */
function textString(text: string): string {
  if (/^[\x20-\x7e]*$/.test(text)) return `(${escapeText(text)})`;
  let hex = 'FEFF';
  for (let i = 0; i < text.length; i++) {
    hex += text.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0');
  }
  return `<${hex}>`;
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

/** A stop on an axial gradient: `offset` runs 0..1 along the gradient axis. */
export interface GradientStop {
  offset: number;
  color: Rgb | string;
}

interface GradientDef {
  /** Resource name, e.g. 'Sh1'. */
  name: string;
  /** Already flipped into PDF (bottom-up) space. */
  coords: [number, number, number, number];
  stops: { offset: number; color: Rgb }[];
}

/** Handle returned by {@link PdfDoc.gradient}; pass it to a paint call. */
export interface GradientRef {
  readonly name: string;
}

const KAPPA = 0.5522847498307936;

/**
 * Collects a path in top-down layout coordinates and paints it.
 *
 * Every method returns `this`, so a path reads as one expression. The paint
 * calls (`fill`, `stroke`, `fillStroke`, `clip`, `shade`) each emit their own
 * `q`/`Q` pair, so a path never leaks graphics state.
 */
export class PathBuilder {
  private readonly segs: string[] = [];

  constructor(
    private readonly page: Page,
    private readonly height: number,
  ) {}

  private fy(y: number): number {
    return this.height - y;
  }

  moveTo(x: number, y: number): this {
    this.segs.push(`${fmt(x)} ${fmt(this.fy(y))} m`);
    return this;
  }

  lineTo(x: number, y: number): this {
    this.segs.push(`${fmt(x)} ${fmt(this.fy(y))} l`);
    return this;
  }

  /** Cubic Bezier through two control points. */
  curveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): this {
    this.segs.push(
      `${fmt(c1x)} ${fmt(this.fy(c1y))} ${fmt(c2x)} ${fmt(this.fy(c2y))} ` +
        `${fmt(x)} ${fmt(this.fy(y))} c`,
    );
    return this;
  }

  close(): this {
    this.segs.push('h');
    return this;
  }

  /** Appends a rectangle as its own subpath. */
  rect(x: number, y: number, w: number, h: number): this {
    this.segs.push(`${fmt(x)} ${fmt(this.fy(y + h))} ${fmt(w)} ${fmt(h)} re`);
    return this;
  }

  /** Appends a rounded rectangle as its own subpath. */
  roundRect(x: number, y: number, w: number, h: number, radius: number): this {
    const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
    if (r === 0) return this.rect(x, y, w, h);
    const k = r * KAPPA;
    const x1 = x + w;
    const y1 = y + h;
    this.moveTo(x + r, y);
    this.lineTo(x1 - r, y);
    this.curveTo(x1 - r + k, y, x1, y + r - k, x1, y + r);
    this.lineTo(x1, y1 - r);
    this.curveTo(x1, y1 - r + k, x1 - r + k, y1, x1 - r, y1);
    this.lineTo(x + r, y1);
    this.curveTo(x + r - k, y1, x, y1 - r + k, x, y1 - r);
    this.lineTo(x, y + r);
    this.curveTo(x, y + r - k, x + r - k, y, x + r, y);
    return this.close();
  }

  /**
   * Appends a full ellipse as its own subpath, optionally rotated.
   *
   * `rotation` is in degrees, clockwise on screen (the layout layer's y grows
   * downward). Two ellipses in one path plus an even-odd fill make a ring.
   */
  ellipse(cx: number, cy: number, rx: number, ry: number, rotation = 0): this {
    const a = (rotation * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const p = (u: number, v: number): [number, number] => [
      cx + u * cos - v * sin,
      cy + u * sin + v * cos,
    ];
    const kx = rx * KAPPA;
    const ky = ry * KAPPA;
    // Four quarter-arcs, walking the unrotated ellipse and rotating each point.
    const pts: [number, number][][] = [
      [
        [rx, 0],
        [rx, ky],
        [kx, ry],
        [0, ry],
      ],
      [
        [0, ry],
        [-kx, ry],
        [-rx, ky],
        [-rx, 0],
      ],
      [
        [-rx, 0],
        [-rx, -ky],
        [-kx, -ry],
        [0, -ry],
      ],
      [
        [0, -ry],
        [kx, -ry],
        [rx, -ky],
        [rx, 0],
      ],
    ];
    const start = p(pts[0]![0]![0], pts[0]![0]![1]);
    this.moveTo(start[0], start[1]);
    for (const arc of pts) {
      const c1 = p(arc[1]![0], arc[1]![1]);
      const c2 = p(arc[2]![0], arc[2]![1]);
      const to = p(arc[3]![0], arc[3]![1]);
      this.curveTo(c1[0], c1[1], c2[0], c2[1], to[0], to[1]);
    }
    return this.close();
  }

  /** Convenience: a closed polygon through the given top-down points. */
  polygon(points: readonly (readonly [number, number])[]): this {
    points.forEach(([x, y], i) => (i === 0 ? this.moveTo(x, y) : this.lineTo(x, y)));
    return this.close();
  }

  fill(color: Rgb | string, evenOdd = false): void {
    if (this.segs.length === 0) return;
    const c = typeof color === 'string' ? hex(color) : color;
    this.page.ops.push(
      'q',
      `${fmt(c.r)} ${fmt(c.g)} ${fmt(c.b)} rg`,
      ...this.segs,
      evenOdd ? 'f*' : 'f',
      'Q',
    );
  }

  stroke(color: Rgb | string, lineWidth = 0.6): void {
    if (this.segs.length === 0) return;
    const c = typeof color === 'string' ? hex(color) : color;
    this.page.ops.push(
      'q',
      `${fmt(c.r)} ${fmt(c.g)} ${fmt(c.b)} RG`,
      `${fmt(lineWidth)} w`,
      '1 J 1 j',
      ...this.segs,
      'S',
      'Q',
    );
  }

  fillStroke(fillColor: Rgb | string, strokeColor: Rgb | string, lineWidth = 0.6): void {
    if (this.segs.length === 0) return;
    const f = typeof fillColor === 'string' ? hex(fillColor) : fillColor;
    const s = typeof strokeColor === 'string' ? hex(strokeColor) : strokeColor;
    this.page.ops.push(
      'q',
      `${fmt(f.r)} ${fmt(f.g)} ${fmt(f.b)} rg`,
      `${fmt(s.r)} ${fmt(s.g)} ${fmt(s.b)} RG`,
      `${fmt(lineWidth)} w`,
      ...this.segs,
      'B',
      'Q',
    );
  }

  /** Paints an axial gradient through this path, using it as the clip. */
  shade(ref: GradientRef, evenOdd = false): void {
    if (this.segs.length === 0) return;
    this.page.ops.push('q', ...this.segs, evenOdd ? 'W* n' : 'W n', `/${ref.name} sh`, 'Q');
  }

  /** Runs `fn` with this path installed as the clip region. */
  clip(fn: () => void, evenOdd = false): void {
    if (this.segs.length === 0) {
      fn();
      return;
    }
    this.page.ops.push('q', ...this.segs, evenOdd ? 'W* n' : 'W n');
    try {
      fn();
    } finally {
      this.page.ops.push('Q');
    }
  }
}

export class PdfDoc {
  private readonly pages: Page[] = [];
  private current: Page;
  private readonly usedFonts = new Set<StdFont>();
  private readonly gradients: GradientDef[] = [];
  /** Keyed by identity so the same logo drawn on every page is stored once. */
  private readonly images = new Map<EmbeddedImage, string>();

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

  // ------------------------------------------------------------------- paths

  /** Starts a path in the same top-down coordinates as the rest of the layer. */
  path(): PathBuilder {
    return new PathBuilder(this.current, this.current.size.height);
  }

  /** Filled rectangle with rounded corners. */
  roundRect(x: number, y: number, w: number, h: number, radius: number, color: Rgb | string): void {
    if (w <= 0 || h <= 0) return;
    this.path().roundRect(x, y, w, h, radius).fill(color);
  }

  /** Stroked rounded-rectangle outline. */
  strokeRoundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    radius: number,
    color: Rgb | string,
    lineWidth = 0.6,
  ): void {
    if (w <= 0 || h <= 0) return;
    this.path().roundRect(x, y, w, h, radius).stroke(color, lineWidth);
  }

  /** Filled polygon — the cover geometry's triangles and wedges. */
  polygon(points: readonly (readonly [number, number])[], color: Rgb | string): void {
    if (points.length < 3) return;
    this.path().polygon(points).fill(color);
  }

  // --------------------------------------------------------------- gradients

  /**
   * Registers an axial (`/ShadingType 2`) gradient running from (x1,y1) to
   * (x2,y2) in top-down layout coordinates. The handle can be painted into any
   * path via {@link PathBuilder.shade} or into a rectangle via
   * {@link PdfDoc.shadeRect}, on any page — shadings live in the shared
   * resource dictionary.
   */
  gradient(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    stops: readonly GradientStop[],
  ): GradientRef {
    const resolved = stops
      .map((s) => ({
        offset: Math.max(0, Math.min(1, s.offset)),
        color: typeof s.color === 'string' ? hex(s.color) : s.color,
      }))
      .sort((a, b) => a.offset - b.offset);
    if (resolved.length === 0) resolved.push({ offset: 0, color: { r: 0, g: 0, b: 0 } });
    if (resolved.length === 1) resolved.push({ ...resolved[0]!, offset: 1 });

    const h = this.size.height;
    const def: GradientDef = {
      name: `Sh${this.gradients.length + 1}`,
      coords: [x1, h - y1, x2, h - y2],
      stops: resolved,
    };
    this.gradients.push(def);
    return { name: def.name };
  }

  /** Paints a registered gradient across a rectangle. */
  shadeRect(x: number, y: number, w: number, h: number, ref: GradientRef): void {
    if (w <= 0 || h <= 0) return;
    this.path().rect(x, y, w, h).shade(ref);
  }

  // ------------------------------------------------------------------ images

  /**
   * Draws a decoded raster into the box (x, y, w, h) given in the same
   * top-down coordinates as everything else. The image is registered on first
   * use and shared by every later placement, so drawing a logo on twenty pages
   * costs one copy of the bytes.
   */
  image(img: EmbeddedImage, x: number, y: number, w: number, h: number): void {
    if (w <= 0 || h <= 0) return;
    let name = this.images.get(img);
    if (!name) {
      name = `Im${this.images.size + 1}`;
      this.images.set(img, name);
    }
    const flippedY = this.current.size.height - y - h;
    // The image space is a unit square, so the CTM is the placement box.
    this.current.ops.push(
      'q',
      `${fmt(w)} 0 0 ${fmt(h)} ${fmt(x)} ${fmt(flippedY)} cm`,
      `/${name} Do`,
      'Q',
    );
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

    // Axial shadings, each with its own interpolation function. Two stops use a
    // single exponential function; more stops are stitched with a type-3.
    const shadingRefs: string[] = [];
    for (const g of this.gradients) {
      const rgb = (c: Rgb): string => `[${fmt(c.r)} ${fmt(c.g)} ${fmt(c.b)}]`;
      let fnNum: number;
      if (g.stops.length === 2) {
        fnNum = addObject(
          `<< /FunctionType 2 /Domain [0 1] /C0 ${rgb(g.stops[0]!.color)} ` +
            `/C1 ${rgb(g.stops[1]!.color)} /N 1 >>`,
        );
      } else {
        const parts: number[] = [];
        for (let i = 0; i < g.stops.length - 1; i++) {
          parts.push(
            addObject(
              `<< /FunctionType 2 /Domain [0 1] /C0 ${rgb(g.stops[i]!.color)} ` +
                `/C1 ${rgb(g.stops[i + 1]!.color)} /N 1 >>`,
            ),
          );
        }
        const bounds = g.stops.slice(1, -1).map((s) => fmt(s.offset));
        const encode = parts.map(() => '0 1').join(' ');
        fnNum = addObject(
          `<< /FunctionType 3 /Domain [0 1] /Functions [${parts.map((n) => `${n} 0 R`).join(' ')}] ` +
            `/Bounds [${bounds.join(' ')}] /Encode [${encode}] >>`,
        );
      }
      const shadingNum = addObject(
        `<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [${g.coords.map(fmt).join(' ')}] ` +
          `/Function ${fnNum} 0 R /Extend [true true] >>`,
      );
      shadingRefs.push(`/${g.name} ${shadingNum} 0 R`);
    }

    // Image XObjects. The soft mask is its own image object, so it has to be
    // written before the one that points at it.
    const xobjectRefs: string[] = [];
    for (const [img, name] of this.images) {
      let smaskNum: number | null = null;
      if (img.smask) {
        smaskNum = addObject(
          `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} ` +
            `/ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode ` +
            `/Length ${img.smask.length} >>\nstream\n${latin1String(img.smask)}\nendstream`,
        );
      }
      const imgNum = addObject(
        `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} ` +
          `/ColorSpace /${img.colorSpace} /BitsPerComponent ${img.bitsPerComponent} ` +
          `/Filter /${img.filter}${smaskNum ? ` /SMask ${smaskNum} 0 R` : ''} ` +
          `/Length ${img.data.length} >>\nstream\n${latin1String(img.data)}\nendstream`,
      );
      xobjectRefs.push(`/${name} ${imgNum} 0 R`);
    }

    const resources =
      '<< /Font << ' +
      (Object.entries(fontObjects) as [StdFont, number][])
        .map(([font, num]) => `/${FONT_RESOURCE[font]} ${num} 0 R`)
        .join(' ') +
      ' >>' +
      (shadingRefs.length ? ` /Shading << ${shadingRefs.join(' ')} >>` : '') +
      (xobjectRefs.length ? ` /XObject << ${xobjectRefs.join(' ')} >>` : '') +
      ' >>';

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
        (this.meta.title ? `/Title ${textString(this.meta.title)} ` : '') +
        (this.meta.author ? `/Author ${textString(this.meta.author)} ` : '') +
        (this.meta.subject ? `/Subject ${textString(this.meta.subject)} ` : '') +
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

/** The inverse of {@link latin1Bytes}: raw bytes as a one-char-per-byte string. */
function latin1String(bytes: Uint8Array): string {
  let out = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return out;
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
