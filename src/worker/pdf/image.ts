/**
 * Raster decoding for the PDF writer.
 *
 * The report used to draw the house mark from vector primitives only, which
 * meant a tenant that uploaded its own logo in the Branding panel saw that logo
 * everywhere except the one artefact it cares most about — the downloaded PDF,
 * which kept showing the house lockup. Embedding an uploaded logo needs the
 * bytes turned into something a PDF image XObject can carry.
 *
 * Two formats are supported, because those are the two a PDF can hold without
 * a rasteriser:
 *
 *   JPEG — passed straight through as /DCTDecode, baseline only.
 *   PNG  — inflated, unfiltered, split into an RGB stream plus an 8-bit
 *          /SMask alpha stream, then re-deflated.
 *
 * PNG is not passed through as-is even though PDF's /FlateDecode plus a PNG
 * predictor can consume an IDAT verbatim: that trick only works while colour
 * and alpha live in separate streams, and the common logo case (colour type 6,
 * RGBA) interleaves them. Decoding is the only way to lift the alpha out into
 * an /SMask, and without the /SMask every transparent pixel paints black.
 *
 * SVG and WebP are accepted by the upload control but cannot be embedded; they
 * decode to null and the caller falls back to the vector lockup.
 *
 * zlib comes from the runtime's CompressionStream/DecompressionStream, which
 * workerd implements natively — hence the async entry point.
 */

export interface EmbeddedImage {
  width: number;
  height: number;
  colorSpace: 'DeviceRGB' | 'DeviceGray';
  bitsPerComponent: number;
  filter: 'FlateDecode' | 'DCTDecode';
  /** Stream bytes exactly as they are written into the PDF object. */
  data: Uint8Array;
  /** Deflated 8-bit grayscale alpha, same dimensions. Absent when opaque. */
  smask?: Uint8Array;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Guards against a pathological upload turning into hundreds of MB of pixels. */
const MAX_PIXELS = 16_000_000;

/**
 * Decodes a `data:` URI into something embeddable, or null when the format is
 * one a PDF cannot carry. Never throws — a malformed upload is a fallback, not
 * a failed report.
 */
export async function decodeImageDataUrl(dataUrl: string): Promise<EmbeddedImage | null> {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return null;
  try {
    if (isPng(parsed.bytes)) return await decodePng(parsed.bytes);
    if (isJpeg(parsed.bytes)) return decodeJpeg(parsed.bytes);
    return null;
  } catch {
    return null;
  }
}

interface ParsedDataUrl {
  mime: string;
  bytes: Uint8Array;
}

function parseDataUrl(value: string): ParsedDataUrl | null {
  const match = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(value.trim());
  if (!match) return null;
  const [, mime, base64, payload] = match;
  if (!base64) return null; // A percent-encoded payload is only ever SVG here.
  try {
    const bin = atob(payload!.replace(/\s+/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
    return { mime: mime || 'application/octet-stream', bytes };
  } catch {
    return null;
  }
}

function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8;
}

// ---------------------------------------------------------------------- PNG

interface Ihdr {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlace: number;
}

async function decodePng(bytes: Uint8Array): Promise<EmbeddedImage | null> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let ihdr: Ihdr | null = null;
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  const idat: Uint8Array[] = [];

  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!,
    );
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (offset + 12 + length > bytes.length) return null; // truncated

    if (type === 'IHDR') {
      ihdr = {
        width: view.getUint32(offset + 8),
        height: view.getUint32(offset + 12),
        bitDepth: bytes[offset + 16]!,
        colorType: bytes[offset + 17]!,
        interlace: bytes[offset + 20]!,
      };
    } else if (type === 'PLTE') {
      palette = body.slice();
    } else if (type === 'tRNS') {
      transparency = body.slice();
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  if (!ihdr || idat.length === 0) return null;
  // Adam7 would need a seven-pass deinterlace for a case no export tool emits
  // for a logo; a vector fallback is better than a wrong picture.
  if (ihdr.interlace !== 0) return null;
  const { width, height, bitDepth, colorType } = ihdr;
  if (width <= 0 || height <= 0 || width * height > MAX_PIXELS) return null;
  if (![1, 2, 4, 8, 16].includes(bitDepth)) return null;
  if (![0, 2, 3, 4, 6].includes(colorType)) return null;
  if (colorType === 3 && !palette) return null;
  // Only indexed and grayscale images are allowed sub-byte samples by the spec.
  if (bitDepth < 8 && colorType !== 0 && colorType !== 3) return null;

  const channels = CHANNELS[colorType]!;
  const raw = unfilter(await inflate(concat(idat)), width, height, bitDepth, channels);
  if (!raw) return null;

  const { rgb, alpha } = toRgba(raw, ihdr, channels, palette, transparency);

  const image: EmbeddedImage = {
    width,
    height,
    colorSpace: 'DeviceRGB',
    bitsPerComponent: 8,
    filter: 'FlateDecode',
    data: await deflate(rgb),
  };
  if (alpha) image.smask = await deflate(alpha);
  return image;
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/**
 * Reverses the per-scanline PNG filters in place, returning the filter bytes
 * stripped out. `raw` is laid out as height rows of `stride` bytes.
 */
function unfilter(
  inflated: Uint8Array,
  width: number,
  height: number,
  bitDepth: number,
  channels: number,
): Uint8Array | null {
  const bitsPerPixel = bitDepth * channels;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, Math.ceil(bitsPerPixel / 8));
  if (inflated.length < height * (stride + 1)) return null;

  const out = new Uint8Array(height * stride);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = inflated[src++]!;
    const row = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    row.set(inflated.subarray(src, src + stride));
    src += stride;

    switch (filter) {
      case 0:
        break;
      case 1: // Sub
        for (let i = bpp; i < stride; i++) row[i] = (row[i]! + row[i - bpp]!) & 0xff;
        break;
      case 2: // Up
        if (prev) for (let i = 0; i < stride; i++) row[i] = (row[i]! + prev[i]!) & 0xff;
        break;
      case 3: // Average
        for (let i = 0; i < stride; i++) {
          const left = i >= bpp ? row[i - bpp]! : 0;
          const up = prev ? prev[i]! : 0;
          row[i] = (row[i]! + ((left + up) >> 1)) & 0xff;
        }
        break;
      case 4: // Paeth
        for (let i = 0; i < stride; i++) {
          const left = i >= bpp ? row[i - bpp]! : 0;
          const up = prev ? prev[i]! : 0;
          const upLeft = prev && i >= bpp ? prev[i - bpp]! : 0;
          row[i] = (row[i]! + paeth(left, up, upLeft)) & 0xff;
        }
        break;
      default:
        return null;
    }
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Expands one scanline into 8-bit-normalised samples (indices stay raw). */
function rowSamples(row: Uint8Array, bitDepth: number, count: number, indexed: boolean): Uint8Array {
  const out = new Uint8Array(count);
  if (bitDepth === 8) {
    out.set(row.subarray(0, count));
    return out;
  }
  if (bitDepth === 16) {
    for (let i = 0; i < count; i++) out[i] = row[i * 2]!; // high byte is enough at 8 bpc
    return out;
  }
  const perByte = 8 / bitDepth;
  const mask = (1 << bitDepth) - 1;
  const scale = indexed ? 1 : 255 / mask;
  for (let i = 0; i < count; i++) {
    const byte = row[Math.floor(i / perByte)] ?? 0;
    const shift = 8 - bitDepth * ((i % perByte) + 1);
    const value = (byte >> shift) & mask;
    out[i] = indexed ? value : Math.round(value * scale);
  }
  return out;
}

function toRgba(
  raw: Uint8Array,
  ihdr: Ihdr,
  channels: number,
  palette: Uint8Array | null,
  transparency: Uint8Array | null,
): { rgb: Uint8Array; alpha: Uint8Array | null } {
  const { width, height, bitDepth, colorType } = ihdr;
  const stride = Math.ceil((width * bitDepth * channels) / 8);
  const rgb = new Uint8Array(width * height * 3);
  const alpha = new Uint8Array(width * height).fill(0xff);
  let translucent = false;

  // tRNS for the non-indexed colour types names one fully transparent colour.
  // Its samples are always a 16-bit pair regardless of the image's own bit
  // depth, so each one has to be folded into the same 8-bit space `rowSamples`
  // produces before it can be compared against a pixel.
  const toSample8 = (hi: number, lo: number): number => {
    const value = (hi << 8) | lo;
    if (bitDepth === 16) return value >> 8;
    if (bitDepth === 8) return value & 0xff;
    const mask = (1 << bitDepth) - 1;
    return Math.round((value & mask) * (255 / mask));
  };
  const keyGray =
    colorType === 0 && transparency && transparency.length >= 2
      ? toSample8(transparency[0]!, transparency[1]!)
      : null;
  const keyRgb =
    colorType === 2 && transparency && transparency.length >= 6
      ? [
          toSample8(transparency[0]!, transparency[1]!),
          toSample8(transparency[2]!, transparency[3]!),
          toSample8(transparency[4]!, transparency[5]!),
        ]
      : null;

  for (let y = 0; y < height; y++) {
    const row = raw.subarray(y * stride, (y + 1) * stride);
    const samples = rowSamples(row, bitDepth, width * channels, colorType === 3);
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 3;
      const pixel = y * width + x;
      const s = x * channels;

      if (colorType === 0 || colorType === 4) {
        const g = samples[s]!;
        rgb[at] = g;
        rgb[at + 1] = g;
        rgb[at + 2] = g;
        if (colorType === 4) alpha[pixel] = samples[s + 1]!;
        else if (keyGray !== null && g === keyGray) alpha[pixel] = 0;
      } else if (colorType === 2 || colorType === 6) {
        rgb[at] = samples[s]!;
        rgb[at + 1] = samples[s + 1]!;
        rgb[at + 2] = samples[s + 2]!;
        if (colorType === 6) alpha[pixel] = samples[s + 3]!;
        else if (
          keyRgb &&
          samples[s] === keyRgb[0] &&
          samples[s + 1] === keyRgb[1] &&
          samples[s + 2] === keyRgb[2]
        ) {
          alpha[pixel] = 0;
        }
      } else {
        const index = samples[s]!;
        const p = index * 3;
        rgb[at] = palette?.[p] ?? 0;
        rgb[at + 1] = palette?.[p + 1] ?? 0;
        rgb[at + 2] = palette?.[p + 2] ?? 0;
        if (transparency) alpha[pixel] = transparency[index] ?? 0xff;
      }

      if (alpha[pixel] !== 0xff) translucent = true;
    }
  }

  return { rgb, alpha: translucent ? alpha : null };
}

// --------------------------------------------------------------------- JPEG

/**
 * Baseline and extended-sequential JPEGs go into the PDF untouched. Progressive
 * (SOF2) and arithmetic-coded frames are refused: /DCTDecode is specified
 * against baseline DCT, and a progressive scan renders inconsistently across
 * viewers — a silently mangled logo is worse than the vector fallback.
 */
function decodeJpeg(bytes: Uint8Array): EmbeddedImage | null {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1]!;
    // Standalone markers carry no length payload.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    if (length < 2) return null;

    if (marker === 0xc0 || marker === 0xc1) {
      const height = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
      const width = (bytes[offset + 7]! << 8) | bytes[offset + 8]!;
      const components = bytes[offset + 9]!;
      if (!width || !height) return null;
      if (components !== 1 && components !== 3) return null; // CMYK needs /Decode games
      return {
        width,
        height,
        colorSpace: components === 1 ? 'DeviceGray' : 'DeviceRGB',
        bitsPerComponent: 8,
        filter: 'DCTDecode',
        data: bytes,
      };
    }
    // Any other frame marker (0xC2..0xCF except the huffman/arithmetic tables).
    if (marker >= 0xc2 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return null;
    }
    if (marker === 0xda) return null; // reached the scan without a usable frame
    offset += 2 + length;
  }
  return null;
}

// --------------------------------------------------------------------- zlib

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function through(bytes: Uint8Array, transform: ReadableWritablePair): Promise<Uint8Array> {
  const piped = streamOf(bytes).pipeThrough(transform as TransformStream<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(piped).arrayBuffer());
}

/** zlib-wrapped inflate — the container PNG's IDAT uses and PDF expects. */
async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  return through(bytes, new DecompressionStream('deflate'));
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  return through(bytes, new CompressionStream('deflate'));
}
