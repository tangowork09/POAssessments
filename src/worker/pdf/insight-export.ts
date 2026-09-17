/**
 * A network question, as a document.
 *
 * The console can already save a PNG, and a PNG is one long picture: the table
 * under it is pixels, so nobody can search it, copy a name out of it, or read
 * it on a phone. This lays the same material out as pages — the picture on its
 * own, then the standings as real text — using the writer the group and member
 * reports are drawn with, so a facilitator's folder holds one kind of document
 * rather than two.
 */

import { BRAND_COMPANY_NAME } from '../../shared/brand.js';
import type { EmbeddedImage } from './image.js';
import { drawLogoLockup } from './report.js';
import { A4, PdfDoc, measure, wrap, type StdFont } from './writer.js';

export interface InsightExportColumn {
  head: string;
  /** Right-aligned for a figure, left for a name. */
  right?: boolean;
  /** Share of the table's width, before the name column takes its minimum. */
  weight?: number;
}

export interface InsightExportPanel {
  title: string;
  /** Label / value pairs, already formatted. */
  rows: [string, string][];
}

export interface InsightExportPayload {
  cohortName: string;
  organisation: string;
  round: string;
  /** The question, and the sentence the data produced. */
  tabTitle: string;
  question: string;
  finding: string;
  /** The picture, as a PNG data URL. Absent when the tab has no picture. */
  imageDataUrl: string | null;
  columns: InsightExportColumn[];
  rows: string[][];
  panels: InsightExportPanel[];
  generatedAt: string;
}

const T = {
  ink: '#0C1421',
  ink2: '#3D4859',
  ink3: '#6A7688',
  line: '#E4E8EE',
  surface: '#FAFBFC',
  accent: '#0B6FB4',
} as const;

const M = { left: 48, right: 48, top: 52, bottom: 56 };
const W = A4.width - M.left - M.right;
const BOTTOM = A4.height - M.bottom;

export function renderInsightExportPdf(
  payload: InsightExportPayload,
  picture: EmbeddedImage | null,
  logo: EmbeddedImage | null,
): Uint8Array {
  const doc = new PdfDoc(A4, {
    title: `${payload.cohortName} — ${payload.tabTitle}`,
    subject: payload.question,
    author: BRAND_COMPANY_NAME,
  });

  let y = header(doc, payload, logo);

  // Page one is the picture and the sentence it produced. A reader who only
  // ever sees this page has the finding and the evidence for it.
  y = doc.paragraph(payload.finding, M.left, y, W, { font: 'Helvetica-Bold', size: 13, color: T.ink, leading: 18 }) + 16;

  if (picture) {
    // Contained, never cropped: a network map that loses its edge loses the
    // people who sit there, who are usually the point.
    const room = { w: W, h: BOTTOM - y - 8 };
    const scale = Math.min(room.w / picture.width, room.h / picture.height);
    const w = picture.width * scale;
    const h = picture.height * scale;
    doc.image(picture, M.left + (W - w) / 2, y, w, h);
    y += h;
  }

  if (payload.rows.length > 0 || payload.panels.length > 0) {
    doc.addPage();
    y = header(doc, payload, logo);
  }

  for (const panel of payload.panels) {
    y = drawPanel(doc, panel, y, payload, logo);
  }

  if (payload.rows.length > 0) {
    y = drawTable(doc, payload, y, logo);
  }

  footers(doc, payload);
  return doc.build();
}

function header(doc: PdfDoc, p: InsightExportPayload, logo: EmbeddedImage | null): number {
  // The lockup owns the top line on its own: crowding a cohort name against it
  // is how the two ended up printed over each other.
  if (logo) drawLogoLockup(doc, M.left, M.top - 14, 20);
  doc.text(p.cohortName, logo ? M.left + 96 : M.left, M.top, {
    font: 'Helvetica-Bold',
    size: 11,
    color: T.ink,
  });
  doc.textRight(`${p.organisation ? `${p.organisation} · ` : ''}${p.round}`, A4.width - M.right, M.top, {
    size: 9,
    color: T.ink3,
  });
  const y = M.top + 16;
  doc.rect(M.left, y, W, 0.8, T.line);
  doc.text(p.tabTitle, M.left, y + 26, { font: 'Helvetica-Bold', size: 15, color: T.ink });
  doc.text(p.question, M.left, y + 42, { size: 9.5, color: T.ink3 });
  return y + 62;
}

function drawPanel(
  doc: PdfDoc,
  panel: InsightExportPanel,
  yIn: number,
  p: InsightExportPayload,
  logo: EmbeddedImage | null,
): number {
  let y = yIn;
  const h = 26 + panel.rows.length * 15 + 10;
  if (y + h > BOTTOM) {
    doc.addPage();
    y = header(doc, p, logo);
  }
  doc.roundRect(M.left, y, W, h, 6, T.surface);
  doc.text(panel.title, M.left + 12, y + 17, { font: 'Helvetica-Bold', size: 10, color: T.ink });
  let ry = y + 34;
  for (const [label, value] of panel.rows) {
    doc.text(truncate(label, 'Helvetica', 9, W - 120), M.left + 12, ry, { size: 9, color: T.ink2 });
    doc.textRight(value, M.left + W - 12, ry, { font: 'Helvetica-Bold', size: 9, color: T.ink });
    ry += 15;
  }
  return y + h + 12;
}

function drawTable(doc: PdfDoc, p: InsightExportPayload, yIn: number, logo: EmbeddedImage | null): number {
  const widths = columnWidths(p.columns);
  let y = yIn;

  const head = () => {
    doc.rect(M.left, y, W, 18, T.surface);
    let x = M.left;
    p.columns.forEach((c, i) => {
      const w = widths[i]!;
      if (c.right) doc.textRight(c.head.toUpperCase(), x + w - 6, y + 12, { font: 'Helvetica-Bold', size: 7.5, color: T.ink3 });
      else doc.text(c.head.toUpperCase(), x + 6, y + 12, { font: 'Helvetica-Bold', size: 7.5, color: T.ink3 });
      x += w;
    });
    y += 18;
  };

  head();
  for (const row of p.rows) {
    if (y + 23 > BOTTOM) {
      doc.addPage();
      y = header(doc, p, logo);
      head();
    }
    let x = M.left;
    p.columns.forEach((c, i) => {
      const w = widths[i]!;
      const text = row[i] ?? '';
      if (c.right) doc.textRight(text, x + w - 6, y + 11.5, { size: 8.5, color: T.ink2 });
      else doc.text(truncate(text, 'Helvetica', 8.5, w - 12), x + 6, y + 11.5, { size: 8.5, color: T.ink2 });
      x += w;
    });
    doc.rect(M.left, y + 21, W, 0.5, T.line);
    y += 23;
  }
  return y;
}

/** The name column takes what it needs; the figures share the rest. */
function columnWidths(columns: readonly InsightExportColumn[]): number[] {
  const weights = columns.map((c) => c.weight ?? (c.right ? 1 : 2));
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => (w / total) * W);
}

function footers(doc: PdfDoc, p: InsightExportPayload): void {
  const total = doc.pageCount;
  for (let i = 0; i < total; i += 1) {
    doc.onPage(i, () => {
      doc.rect(M.left, A4.height - M.bottom + 18, W, 0.8, T.line);
      doc.text(`Confidential — ${p.cohortName}`, M.left, A4.height - M.bottom + 32, { size: 8, color: T.ink3 });
      doc.textRight(`Page ${i + 1} of ${total}`, A4.width - M.right, A4.height - M.bottom + 32, {
        size: 8,
        color: T.ink3,
      });
    });
  }
}

function truncate(text: string, font: StdFont, size: number, max: number): string {
  if (measure(text, font, size) <= max) return text;
  const line = wrap(text, font, size, max)[0] ?? text;
  return line === text ? text : `${line.trimEnd()}…`;
}
