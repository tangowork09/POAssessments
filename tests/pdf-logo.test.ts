/**
 * The tenant logo in the PDF.
 *
 * The report used to draw the house lockup unconditionally, so a tenant that
 * had uploaded its own logo saw that logo in the app, in the report page and
 * in its emails — and the house mark in the one artefact it hands to a client,
 * the downloaded PDF. These cover the decode path and the embedding, including
 * the alpha channel, because a PNG embedded without its /SMask paints every
 * transparent pixel black.
 */

import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodeImageDataUrl, type EmbeddedImage } from '../src/worker/pdf/image.js';
import { renderReportPdf } from '../src/worker/pdf/report.js';
import { A4, PdfDoc } from '../src/worker/pdf/writer.js';
import { buildReport } from '../src/worker/lib/report.js';
import { ASSESSMENT_ID } from '../src/shared/assessments.js';
import { QUESTION_COUNT } from '../src/shared/scoring.js';
import { BRAND_LOGO_DATA_URL } from '../src/shared/brand.js';
import type { IsiReportPayload } from '../src/shared/types.js';

function latin1(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1');
}

// ------------------------------------------------------------- PNG fixtures

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  let c = 0xffffffff;
  for (const b of body) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE((c ^ 0xffffffff) >>> 0);
  return Buffer.concat([len, body, crc]);
}

/**
 * Builds a PNG from already-filtered scanlines. `rows` excludes the filter
 * byte; `filter` is prepended to every row, so filter 0 (None) keeps the
 * samples literal and any other value exercises the unfilter path.
 */
function png(
  width: number,
  height: number,
  bitDepth: number,
  colorType: number,
  rows: readonly (readonly number[])[],
  extra: readonly Buffer[] = [],
  filter = 0,
  interlace = 0,
): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  ihdr[12] = interlace;
  const raw = Buffer.concat(rows.map((r) => Buffer.from([filter, ...r])));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...extra,
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function dataUrl(mime: string, bytes: Buffer): string {
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

/** 2x2 RGBA: opaque red, opaque green, transparent blue, half-alpha white. */
const RGBA_PNG = png(2, 2, 8, 6, [
  [255, 0, 0, 255, 0, 255, 0, 255],
  [0, 0, 255, 0, 255, 255, 255, 128],
]);

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes);
      c.close();
    },
  }).pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The RGB and alpha planes an embedded image will actually paint. */
async function planes(img: EmbeddedImage): Promise<{ rgb: number[]; alpha: number[] | null }> {
  return {
    rgb: [...(await inflate(img.data))],
    alpha: img.smask ? [...(await inflate(img.smask))] : null,
  };
}

// ------------------------------------------------------------------ decoding

describe('decodeImageDataUrl — PNG', () => {
  it('lifts the alpha channel of an RGBA image into a separate soft mask', async () => {
    const img = (await decodeImageDataUrl(dataUrl('image/png', RGBA_PNG)))!;
    expect(img).not.toBeNull();
    expect(img.width).toBe(2);
    expect(img.height).toBe(2);
    expect(img.colorSpace).toBe('DeviceRGB');
    expect(img.bitsPerComponent).toBe(8);
    expect(img.filter).toBe('FlateDecode');

    const { rgb, alpha } = await planes(img);
    expect(rgb).toEqual([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
    expect(alpha).toEqual([255, 255, 0, 128]);
  });

  it('omits the soft mask when every pixel is opaque', async () => {
    const opaque = png(2, 1, 8, 2, [[1, 2, 3, 4, 5, 6]]);
    const img = (await decodeImageDataUrl(dataUrl('image/png', opaque)))!;
    expect(img.smask).toBeUndefined();
    expect((await planes(img)).rgb).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('expands grayscale to RGB and honours a grayscale tRNS colour key', async () => {
    const trns = chunk('tRNS', Buffer.from([0x00, 0x40])); // grey 0x40 is transparent
    const grey = png(3, 1, 8, 0, [[0x00, 0x40, 0xff]], [trns]);
    const img = (await decodeImageDataUrl(dataUrl('image/png', grey)))!;
    const { rgb, alpha } = await planes(img);
    expect(rgb).toEqual([0, 0, 0, 0x40, 0x40, 0x40, 255, 255, 255]);
    expect(alpha).toEqual([255, 0, 255]);
  });

  it('resolves an indexed palette and its per-entry alpha', async () => {
    const plte = chunk('PLTE', Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255]));
    const trns = chunk('tRNS', Buffer.from([255, 0])); // entry 1 fully transparent
    // Bit depth 2: three 2-bit indices (0, 1, 2) packed into one byte.
    const indexed = png(3, 1, 2, 3, [[0b00_01_10_00]], [plte, trns]);
    const img = (await decodeImageDataUrl(dataUrl('image/png', indexed)))!;
    const { rgb, alpha } = await planes(img);
    expect(rgb).toEqual([255, 0, 0, 0, 255, 0, 0, 0, 255]);
    // Entry 2 has no tRNS byte, which the spec reads as fully opaque.
    expect(alpha).toEqual([255, 0, 255]);
  });

  it('reverses the Sub scanline filter', async () => {
    // Filter 1 (Sub) stores each byte as a delta from the pixel to its left.
    const subbed = png(3, 1, 8, 2, [[10, 20, 30, 5, 5, 5, 5, 5, 5]], [], 1);
    const img = (await decodeImageDataUrl(dataUrl('image/png', subbed)))!;
    expect((await planes(img)).rgb).toEqual([10, 20, 30, 15, 25, 35, 20, 30, 40]);
  });

  it('reverses the Up scanline filter across rows', async () => {
    const upped = png(
      1,
      3,
      8,
      2,
      [
        [10, 20, 30],
        [1, 1, 1],
        [2, 2, 2],
      ],
      [],
      2,
    );
    const img = (await decodeImageDataUrl(dataUrl('image/png', upped)))!;
    expect((await planes(img)).rgb).toEqual([10, 20, 30, 11, 21, 31, 13, 23, 33]);
  });

  it('takes the high byte of a 16-bit image', async () => {
    const deep = png(1, 1, 16, 2, [[0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc]]);
    const img = (await decodeImageDataUrl(dataUrl('image/png', deep)))!;
    expect((await planes(img)).rgb).toEqual([0x12, 0x56, 0x9a]);
  });

  it('refuses an interlaced image rather than deinterlacing it wrongly', async () => {
    const adam7 = png(2, 1, 8, 2, [[1, 2, 3, 4, 5, 6]], [], 0, 1);
    expect(await decodeImageDataUrl(dataUrl('image/png', adam7))).toBeNull();
  });

  it('decodes the shipped house logo — a real transparent RGBA PNG', async () => {
    const img = (await decodeImageDataUrl(BRAND_LOGO_DATA_URL))!;
    expect(img.width).toBe(331);
    expect(img.height).toBe(140);
    expect(img.smask).toBeDefined();
  });
});

describe('decodeImageDataUrl — JPEG', () => {
  /** A marker skeleton: SOI, an APP0 to be skipped, then the given frame. */
  function jpeg(sofMarker: number, components: number): Buffer {
    const sof = Buffer.from([
      0xff, sofMarker, 0x00, 8 + components * 3, 0x08,
      0x00, 0x64, // height 100
      0x00, 0xc8, // width 200
      components,
      ...Array.from({ length: components * 3 }, () => 0x01),
    ]);
    return Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]),
      sof,
      Buffer.from([0xff, 0xda, 0x00, 0x02]),
    ]);
  }

  it('passes a baseline colour frame through as DCTDecode', async () => {
    const img = (await decodeImageDataUrl(dataUrl('image/jpeg', jpeg(0xc0, 3))))!;
    expect(img.width).toBe(200);
    expect(img.height).toBe(100);
    expect(img.colorSpace).toBe('DeviceRGB');
    expect(img.filter).toBe('DCTDecode');
    expect(img.smask).toBeUndefined();
  });

  it('reads a single-component frame as grayscale', async () => {
    const img = (await decodeImageDataUrl(dataUrl('image/jpeg', jpeg(0xc1, 1))))!;
    expect(img.colorSpace).toBe('DeviceGray');
  });

  it('refuses progressive and CMYK frames, which DCTDecode cannot be trusted with', async () => {
    expect(await decodeImageDataUrl(dataUrl('image/jpeg', jpeg(0xc2, 3)))).toBeNull();
    expect(await decodeImageDataUrl(dataUrl('image/jpeg', jpeg(0xc0, 4)))).toBeNull();
  });
});

describe('decodeImageDataUrl — unusable input', () => {
  it('returns null instead of throwing', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(await decodeImageDataUrl(dataUrl('image/svg+xml', svg))).toBeNull();
    expect(await decodeImageDataUrl('data:image/svg+xml,%3Csvg%2F%3E')).toBeNull();
    expect(await decodeImageDataUrl(dataUrl('image/png', Buffer.from('not a png')))).toBeNull();
    expect(await decodeImageDataUrl('')).toBeNull();
    expect(await decodeImageDataUrl('https://example.com/logo.png')).toBeNull();
    // A PNG header whose IDAT is not valid zlib.
    const broken = Buffer.concat([RGBA_PNG.subarray(0, 40), Buffer.alloc(20)]);
    expect(await decodeImageDataUrl(dataUrl('image/png', broken))).toBeNull();
  });
});

// ------------------------------------------------------------- the XObject

describe('PdfDoc.image', () => {
  it('writes the image, its soft mask and the placement matrix', async () => {
    const logo = (await decodeImageDataUrl(dataUrl('image/png', RGBA_PNG)))!;
    const doc = new PdfDoc(A4);
    doc.image(logo, 20, 30, 100, 50);
    const s = latin1(doc.build());

    expect(s).toContain('/XObject << /Im1');
    expect(s).toContain('/Subtype /Image /Width 2 /Height 2');
    expect(s).toContain('/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode');
    expect(s).toMatch(/\/SMask \d+ 0 R/);
    expect(s).toContain('/ColorSpace /DeviceGray');
    // The unit image square is scaled to the box and flipped into PDF space.
    expect(s).toContain(`100 0 0 50 20 ${A4.height - 30 - 50} cm`);
    expect(s).toContain('/Im1 Do');
  });

  it('stores one copy of an image drawn on several pages', async () => {
    const logo = (await decodeImageDataUrl(dataUrl('image/png', RGBA_PNG)))!;
    const doc = new PdfDoc(A4);
    doc.image(logo, 0, 0, 10, 10);
    doc.addPage();
    doc.image(logo, 0, 0, 10, 10);
    const s = latin1(doc.build());
    expect(s.match(/\/Im1 Do/g)).toHaveLength(2);
    // One colour object and its one soft mask — not one pair per placement.
    expect(s.match(/\/ColorSpace \/DeviceRGB \/BitsPerComponent/g)).toHaveLength(1);
    expect(s.match(/\/ColorSpace \/DeviceGray \/BitsPerComponent/g)).toHaveLength(1);
    expect(s).not.toContain('/Im2');
  });

  it('declares a byte-accurate stream length', async () => {
    const logo = (await decodeImageDataUrl(dataUrl('image/png', RGBA_PNG)))!;
    const doc = new PdfDoc(A4);
    doc.image(logo, 0, 0, 10, 10);
    const s = latin1(doc.build());
    const declared = Number(/\/Filter \/FlateDecode \/SMask \d+ 0 R \/Length (\d+)/.exec(s)![1]);
    expect(declared).toBe(logo.data.length);
  });
});

// ----------------------------------------------------------------- the report

describe('renderReportPdf — branding logo', () => {
  const answers: Record<number, number> = {};
  for (let n = 1; n <= QUESTION_COUNT; n++) answers[n] = (n * 3) % 5;

  const report = buildReport({
    reportToken: 'r'.repeat(43),
    assessmentId: ASSESSMENT_ID.isi,
    assessmentName: 'Influencing Style Inventory',
    candidate: {
      firstName: 'Priya',
      lastName: 'Sharma',
      email: 'priya@example.com',
      organisation: 'Northwind Retail',
      ageBand: '30-39',
      experienceBand: '5-10',
      gender: 'female',
    },
    completedAt: '2026-08-09 10:30:00',
    branding: {
      companyName: 'Northwind Retail',
      accentColor: '#7A1FA2',
      logoDataUrl: '',
      supportEmail: '',
    },
    answers,
  }) as IsiReportPayload;

  it('draws the house lockup when no logo is supplied', () => {
    const s = latin1(renderReportPdf(report));
    expect(s).not.toContain('/XObject');
    expect(s).toContain('(PO) Tj'); // the vector wordmark
  });

  it('replaces the house lockup with the tenant logo on the cover and every header', async () => {
    const logo = (await decodeImageDataUrl(dataUrl('image/png', RGBA_PNG)))!;
    const bytes = renderReportPdf(report, logo);
    const s = latin1(bytes);
    const pages = Number(/\/Count (\d+)/.exec(s)![1]);

    expect(s).toContain('/XObject << /Im1');
    // Cover lockup plus one running header on each of the other pages.
    expect(s.match(/\/Im1 Do/g)).toHaveLength(pages);
    // The house wordmark and its ribbon must be gone.
    expect(s).not.toContain('(PO) Tj');
    expect(s).not.toContain('(POTENTIAL, POSSIBILITIES) Tj');
  });

  it('keeps the tenant logo inside its box whatever its aspect ratio', async () => {
    const wide = (await decodeImageDataUrl(dataUrl('image/png', png(40, 1, 8, 2, [
      Array.from({ length: 120 }, (_, i) => i % 256),
    ]))))!;
    const s = latin1(renderReportPdf(report, wide));
    // A 40:1 logo would be 2160pt wide at the cover's 54pt height; it is capped
    // to half the content column instead, with the height following.
    for (const [, w] of s.matchAll(/^([\d.]+) 0 0 [\d.]+ [\d.]+ [\d.]+ cm$/gm)) {
      expect(Number(w)).toBeLessThanOrEqual((595.28 - 112) * 0.5 + 0.01);
    }
    expect(s).toContain('/Im1 Do');
  });

  it('still numbers and footers every page with a logo in place', async () => {
    const logo = (await decodeImageDataUrl(dataUrl('image/png', RGBA_PNG)))!;
    const s = latin1(renderReportPdf(report, logo));
    const count = Number(/\/Count (\d+)/.exec(s)![1]);
    for (let i = 1; i <= count; i++) expect(s).toContain(`Page ${i} of ${count}`);
  });

  it('is deterministic for the same logo', async () => {
    const logo = (await decodeImageDataUrl(dataUrl('image/png', RGBA_PNG)))!;
    const a = Buffer.from(renderReportPdf(report, logo));
    const b = Buffer.from(renderReportPdf(report, logo));
    expect(a.equals(b)).toBe(true);
  });
});
