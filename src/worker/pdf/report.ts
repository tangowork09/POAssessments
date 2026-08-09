/**
 * Enterprise business-document report layout.
 *
 * Mirrors the approved mockup section for section: cover meta strip, executive
 * summary, push/pull split, ten banded bars, top-three narratives with overuse
 * cautions, development area, confidentiality footer on every page.
 */

import { MAX_SIDE_SCORE, MAX_STYLE_SCORE } from '../../shared/scoring.js';
import type { ReportPayload } from '../../shared/types.js';
import { A4, PdfDoc, measure } from './writer.js';

/** Design tokens lifted from the Enterprise mockup. */
const T = {
  ink: '#0C1421',
  ink2: '#3D4859',
  ink3: '#6A7688',
  ink4: '#8D97A6',
  line: '#E4E8EE',
  line2: '#D6DCE5',
  surface2: '#FAFBFC',
  surface3: '#F1F4F8',
  accent: '#1A4FD6',
  accent3: '#0F3390',
  accentSoft: '#EDF2FE',
  accentLine: '#C2D3FA',
  push: '#B4530E',
  pushSoft: '#FDF2E7',
  pull: '#1A4FD6',
  warn: '#B54708',
  warnSoft: '#FFFAEB',
  warnLine: '#F5DA9C',
  warnInk: '#7A3B0B',
  devInk: '#1A3670',
};

const M = { left: 52, right: 52, top: 52, bottom: 64 };
const CONTENT_W = A4.width - M.left - M.right;
const PAGE_BOTTOM = A4.height - M.bottom;

interface Cursor {
  y: number;
}

export function renderReportPdf(report: ReportPayload): Uint8Array {
  const accent = report.branding.accentColor || T.accent;
  const doc = new PdfDoc(A4, {
    title: `${report.assessmentName} — ${report.candidate.firstName} ${report.candidate.lastName}`,
    author: report.branding.companyName,
    subject: 'Confidential assessment report',
  });

  const cur: Cursor = { y: M.top };

  drawSheetHead(doc, report, cur, accent);
  drawTitleBlock(doc, report, cur, accent);
  drawSubjectStrip(doc, report, cur);
  drawExecSummary(doc, report, cur, accent);
  drawHeadline(doc, report, cur, accent);
  drawSplit(doc, report, cur);
  drawBars(doc, report, cur);
  drawNarratives(doc, report, cur, accent);
  drawDevelopment(doc, report, cur, accent);
  drawFooters(doc, report);

  return doc.build();
}

// --------------------------------------------------------------- page breaks

function ensure(doc: PdfDoc, cur: Cursor, needed: number): void {
  if (cur.y + needed <= PAGE_BOTTOM) return;
  doc.addPage();
  cur.y = M.top;
}

// -------------------------------------------------------------------- header

function drawSheetHead(doc: PdfDoc, report: ReportPayload, cur: Cursor, accent: string): void {
  const y = cur.y;
  // Logo slot: a solid accent square with the company initial. Raster logo data
  // is rendered in the HTML report and the emails; the PDF keeps a vector mark
  // so the file stays a few kilobytes.
  doc.rect(M.left, y, 26, 26, accent);
  const initial = (report.branding.companyName || 'A').trim().charAt(0).toUpperCase();
  doc.textCentre(initial, M.left + 13, y + 7.5, { font: 'Helvetica-Bold', size: 13, color: '#FFFFFF' });

  doc.text(report.branding.companyName, M.left + 36, y + 3, {
    font: 'Helvetica-Bold',
    size: 10.5,
    color: T.ink,
  });
  doc.text(report.assessmentName, M.left + 36, y + 15, { size: 8.5, color: T.ink4 });

  const right = A4.width - M.right;
  doc.textRight('CONFIDENTIAL REPORT', right, y + 2, {
    font: 'Helvetica-Bold',
    size: 8,
    color: T.ink,
    charSpacing: 0.7,
  });
  doc.textRight(`Issued ${formatDate(report.completedAt)}`, right, y + 13, { size: 8.5, color: T.ink3 });
  doc.textRight(`Ref ${report.reportToken.slice(0, 10).toUpperCase()}`, right, y + 24, {
    size: 8.5,
    color: T.ink3,
  });

  cur.y = y + 40;
  doc.hr(M.left, cur.y, CONTENT_W, T.line2, 0.8);
  cur.y += 26;
}

function drawTitleBlock(doc: PdfDoc, report: ReportPayload, cur: Cursor, accent: string): void {
  doc.text('ASSESSMENT REPORT', M.left, cur.y, {
    font: 'Helvetica-Bold',
    size: 8,
    color: accent,
    charSpacing: 0.9,
  });
  cur.y += 16;
  doc.text(report.assessmentName, M.left, cur.y, { font: 'Helvetica-Bold', size: 23, color: T.ink });
  cur.y += 34;
}

function drawSubjectStrip(doc: PdfDoc, report: ReportPayload, cur: Cursor): void {
  const c = report.candidate;
  const cells: [string, string][] = [
    ['CANDIDATE', `${c.firstName} ${c.lastName}`.trim() || '—'],
    ['ORGANISATION', c.organisation || '—'],
    ['EXPERIENCE', c.experienceBand || '—'],
    ['COMPLETED', formatDate(report.completedAt)],
  ];
  const h = 44;
  const cellW = CONTENT_W / cells.length;

  doc.rect(M.left, cur.y, CONTENT_W, h, T.surface2);
  doc.strokeRect(M.left, cur.y, CONTENT_W, h, T.line, 0.6);

  cells.forEach(([label, value], i) => {
    const x = M.left + i * cellW;
    if (i > 0) doc.line(x, cur.y, x, cur.y + h, T.line, 0.6);
    doc.text(label, x + 12, cur.y + 10, {
      font: 'Helvetica-Bold',
      size: 6.8,
      color: T.ink4,
      charSpacing: 0.6,
    });
    doc.text(truncate(value, 'Helvetica-Bold', 9.5, cellW - 24), x + 12, cur.y + 23, {
      font: 'Helvetica-Bold',
      size: 9.5,
      color: T.ink,
    });
  });

  cur.y += h + 28;
}

// ------------------------------------------------------------------ sections

/**
 * `needed` is the height of the first block that follows, so a heading is never
 * left stranded at the foot of a page without its content.
 */
function sectionHead(doc: PdfDoc, cur: Cursor, title: string, note: string, needed = 0): void {
  ensure(doc, cur, 46 + Math.min(needed, PAGE_BOTTOM - M.top - 46));
  doc.text(title, M.left, cur.y, { font: 'Helvetica-Bold', size: 11.5, color: T.ink });
  if (note) doc.textRight(note, A4.width - M.right, cur.y + 2, { size: 8, color: T.ink4 });
  cur.y += 16;
  doc.hr(M.left, cur.y, CONTENT_W, T.line2, 0.7);
  cur.y += 16;
}

function drawExecSummary(doc: PdfDoc, report: ReportPayload, cur: Cursor, accent: string): void {
  const pad = 18;
  const textW = CONTENT_W - pad * 2;
  const bodyH = doc.paragraphHeight(report.summary, textW, { size: 10, leading: 15.5 });
  const boxH = bodyH + pad * 2 + 20;

  ensure(doc, cur, boxH);
  doc.rect(M.left, cur.y, CONTENT_W, boxH, T.surface2);
  doc.strokeRect(M.left, cur.y, CONTENT_W, boxH, T.line, 0.6);
  // The accent tab that opens the exec block in the mockup.
  doc.rect(M.left, cur.y, 3, boxH, accent);

  doc.rect(M.left + pad, cur.y + pad + 4, 14, 2, accent);
  doc.text('EXECUTIVE SUMMARY', M.left + pad + 22, cur.y + pad, {
    font: 'Helvetica-Bold',
    size: 8,
    color: T.ink,
    charSpacing: 0.8,
  });
  doc.paragraph(report.summary, M.left + pad, cur.y + pad + 20, textW, {
    size: 10,
    leading: 15.5,
    color: T.ink2,
  });

  cur.y += boxH + 26;
}

function drawHeadline(doc: PdfDoc, report: ReportPayload, cur: Cursor, accent: string): void {
  const lead = report.narratives[0];
  if (!lead) return;
  const h = 76;
  ensure(doc, cur, h);

  doc.rect(M.left, cur.y, CONTENT_W, h, '#FFFFFF');
  doc.strokeRect(M.left, cur.y, CONTENT_W, h, T.line, 0.6);

  doc.text('DOMINANT STYLE', M.left + 18, cur.y + 16, {
    font: 'Helvetica-Bold',
    size: 7.5,
    color: T.ink4,
    charSpacing: 0.8,
  });
  doc.text(lead.name, M.left + 18, cur.y + 30, { font: 'Helvetica-Bold', size: 19, color: T.ink });
  doc.text(lead.blurb, M.left + 18, cur.y + 55, { size: 9, color: T.ink3 });

  const right = A4.width - M.right - 18;
  const sideColor = lead.side === 'push' ? T.push : T.pull;
  doc.textRight(`${lead.score}`, right - 26, cur.y + 22, {
    font: 'Helvetica-Bold',
    size: 30,
    color: sideColor,
  });
  doc.textRight(`/ ${MAX_STYLE_SCORE}`, right, cur.y + 33, { size: 11, color: T.ink4 });
  drawPill(doc, right, cur.y + 56, `${lead.band} band`, sideColor);

  cur.y += h + 28;
}

function drawPill(doc: PdfDoc, right: number, y: number, label: string, color: string): void {
  const w = measure(label, 'Helvetica-Bold', 7.5) + 18;
  const x = right - w;
  doc.rect(x, y, w, 15, color === T.push ? T.pushSoft : T.accentSoft);
  doc.strokeRect(x, y, w, 15, color === T.push ? '#F3D4B4' : T.accentLine, 0.6);
  doc.text(label, x + 9, y + 4, { font: 'Helvetica-Bold', size: 7.5, color });
}

function drawSplit(doc: PdfDoc, report: ReportPayload, cur: Cursor): void {
  sectionHead(doc, cur, 'Push and Pull balance', `Each side scored out of ${MAX_SIDE_SCORE}`, 92);
  const s = report.scores;
  ensure(doc, cur, 92);

  const right = A4.width - M.right;
  doc.text('PUSH', M.left, cur.y, { font: 'Helvetica-Bold', size: 8.5, color: T.push, charSpacing: 0.6 });
  doc.text(String(s.push), M.left, cur.y + 13, { font: 'Helvetica-Bold', size: 17, color: T.push });
  doc.text(`${s.pushShare}% of total`, M.left, cur.y + 33, { size: 8, color: T.ink4 });

  doc.textRight('PULL', right, cur.y, {
    font: 'Helvetica-Bold',
    size: 8.5,
    color: T.pull,
    charSpacing: 0.6,
  });
  doc.textRight(String(s.pull), right, cur.y + 13, { font: 'Helvetica-Bold', size: 17, color: T.pull });
  doc.textRight(`${s.pullShare}% of total`, right, cur.y + 33, { size: 8, color: T.ink4 });

  const barY = cur.y + 50;
  const barH = 11;
  const total = s.push + s.pull;
  const pushW = total === 0 ? CONTENT_W / 2 : (s.push / total) * (CONTENT_W - 2);

  doc.rect(M.left, barY, Math.max(pushW, 0), barH, T.push);
  doc.rect(M.left + pushW + 2, barY, Math.max(CONTENT_W - pushW - 2, 0), barH, T.pull);

  doc.text('All Push', M.left, barY + barH + 6, { size: 7.5, color: T.ink4 });
  doc.textCentre('Balanced', M.left + CONTENT_W / 2, barY + barH + 6, { size: 7.5, color: T.ink4 });
  doc.textRight('All Pull', right, barY + barH + 6, { size: 7.5, color: T.ink4 });

  doc.text(
    `Orientation: ${s.orientation}`,
    M.left,
    barY + barH + 22,
    { size: 9, color: T.ink2, font: 'Helvetica-Bold' },
  );

  cur.y = barY + barH + 44;
}

function drawBars(doc: PdfDoc, report: ReportPayload, cur: Cursor): void {
  // Keep the heading with the whole first (Push) group: 16pt group head,
  // five 20pt rows and the axis.
  sectionHead(doc, cur, 'All ten styles', `Each style scored out of ${MAX_STYLE_SCORE}`, 16 + 5 * 20 + 18);

  for (const side of ['push', 'pull'] as const) {
    const styles = report.scores.styles.filter((s) => s.side === side);
    const color = side === 'push' ? T.push : T.pull;
    const heading = side === 'push' ? 'PUSH STYLES' : 'PULL STYLES';
    const note = side === 'push' ? 'What you bring to the exchange' : 'What draws others in';

    ensure(doc, cur, 40 + styles.length * 22);
    doc.rect(M.left, cur.y + 1, 7, 7, color);
    doc.text(heading, M.left + 13, cur.y, {
      font: 'Helvetica-Bold',
      size: 7.8,
      color: T.ink2,
      charSpacing: 0.7,
    });
    doc.text(note, M.left + 13 + measure(heading, 'Helvetica-Bold', 7.8) + 10, cur.y, {
      size: 7.8,
      color: T.ink4,
    });
    cur.y += 16;

    const labelW = 132;
    const valueW = 96;
    const trackX = M.left + labelW;
    const trackW = CONTENT_W - labelW - valueW;

    for (const s of styles) {
      ensure(doc, cur, 24);
      doc.text(truncate(s.name, 'Helvetica', 9, labelW - 10), M.left, cur.y + 2.5, {
        size: 9,
        color: T.ink2,
      });

      doc.rect(trackX, cur.y, trackW, 9, T.surface3);
      // Band dividers at 7/20 and 13/20 — the Low|Moderate|High boundaries.
      for (const boundary of [7, 13]) {
        const bx = trackX + (boundary / MAX_STYLE_SCORE) * trackW;
        doc.rect(bx, cur.y, 0.8, 9, '#FFFFFF');
      }
      doc.rect(trackX, cur.y, (s.score / MAX_STYLE_SCORE) * trackW, 9, s.side === 'push' ? T.push : T.pull);

      const right = A4.width - M.right;
      const scoreLabel = `${s.score}`;
      const slash = ` / ${MAX_STYLE_SCORE}`;
      const bandLabel = `  ${s.band}`;
      const bandW = measure(bandLabel, 'Helvetica', 7.8);
      const slashW = measure(slash, 'Helvetica', 8);
      doc.textRight(bandLabel, right, cur.y + 2, { size: 7.8, color: T.ink3 });
      doc.textRight(slash, right - bandW, cur.y + 1.6, { size: 8, color: T.ink4 });
      doc.textRight(scoreLabel, right - bandW - slashW, cur.y + 1, {
        font: 'Helvetica-Bold',
        size: 9,
        color: T.ink,
      });

      cur.y += 20;
    }

    // Axis under each group.
    doc.text('0', trackX, cur.y - 4, { size: 7, color: T.ink4 });
    doc.textCentre('10', trackX + trackW / 2, cur.y - 4, { size: 7, color: T.ink4 });
    doc.textRight(String(MAX_STYLE_SCORE), trackX + trackW, cur.y - 4, { size: 7, color: T.ink4 });
    cur.y += 18;
  }

  cur.y += 8;
}

function drawNarratives(doc: PdfDoc, report: ReportPayload, cur: Cursor, accent: string): void {
  sectionHead(doc, cur, 'Your top three styles', 'Narrative and overuse risk', 140);

  report.narratives.forEach((n, i) => {
    const pad = 16;
    const textW = CONTENT_W - pad * 2;
    const narrativeH = doc.paragraphHeight(n.narrative, textW, { size: 9.5, leading: 15 });
    const cautionH = doc.paragraphHeight(n.caution, textW - 24, { size: 9, leading: 14 });
    const headH = 46;
    const cautionBoxH = cautionH + 30;
    const boxH = headH + narrativeH + cautionBoxH + pad + 10;

    ensure(doc, cur, Math.min(boxH, PAGE_BOTTOM - M.top));
    const top = cur.y;

    doc.strokeRect(M.left, top, CONTENT_W, boxH, T.line, 0.6);
    doc.rect(M.left + 0.6, top + 0.6, CONTENT_W - 1.2, headH - 0.6, T.surface2);
    doc.hr(M.left, top + headH, CONTENT_W, T.line, 0.6);

    // Rank chip
    doc.rect(M.left + pad, top + 13, 20, 20, T.surface3);
    doc.textCentre(String(i + 1), M.left + pad + 10, top + 18, {
      font: 'Helvetica-Bold',
      size: 9.5,
      color: T.ink2,
    });

    doc.text(n.name, M.left + pad + 30, top + 13, { font: 'Helvetica-Bold', size: 11, color: T.ink });
    doc.text(`${n.side === 'push' ? 'Push style' : 'Pull style'} · ${n.blurb}`, M.left + pad + 30, top + 27, {
      size: 8.2,
      color: T.ink3,
    });

    const right = A4.width - M.right - pad;
    const suffix = ` / ${MAX_STYLE_SCORE}`;
    const suffixW = measure(suffix, 'Helvetica', 8);
    doc.textRight(suffix, right, top + 20, { size: 8, color: T.ink4 });
    doc.textRight(String(n.score), right - suffixW, top + 17, {
      font: 'Helvetica-Bold',
      size: 12,
      color: n.side === 'push' ? T.push : T.pull,
    });

    let y = top + headH + pad;
    y = doc.paragraph(n.narrative, M.left + pad, y, textW, { size: 9.5, leading: 15, color: T.ink2 });

    y += 8;
    const cautionTop = y;
    doc.rect(M.left + pad, cautionTop, textW, cautionH + 26, T.warnSoft);
    doc.rect(M.left + pad, cautionTop, 2.5, cautionH + 26, T.warnLine);
    doc.text('WHEN OVERUSED', M.left + pad + 12, cautionTop + 9, {
      font: 'Helvetica-Bold',
      size: 7,
      color: T.warn,
      charSpacing: 0.8,
    });
    doc.paragraph(n.caution, M.left + pad + 12, cautionTop + 21, textW - 24, {
      size: 9,
      leading: 14,
      color: T.warnInk,
    });

    cur.y = top + boxH + 14;
  });

  cur.y += 10;
  void accent;
}

function drawDevelopment(doc: PdfDoc, report: ReportPayload, cur: Cursor, accent: string): void {
  sectionHead(doc, cur, 'Development area', 'Your least-used style', 120);

  const d = report.development;
  const pad = 18;
  const textW = CONTENT_W - pad * 2;
  const lowH = doc.paragraphHeight(d.low, textW, { size: 9.5, leading: 15 });
  const actionH = doc.paragraphHeight(d.action, textW - 24, { size: 9.5, leading: 15 });
  const boxH = pad * 2 + 24 + lowH + 14 + actionH + 26;

  ensure(doc, cur, Math.min(boxH, PAGE_BOTTOM - M.top));
  const top = cur.y;

  doc.rect(M.left, top, CONTENT_W, boxH, T.accentSoft);
  doc.strokeRect(M.left, top, CONTENT_W, boxH, T.accentLine, 0.6);

  doc.text(d.name, M.left + pad, top + pad, { font: 'Helvetica-Bold', size: 12, color: T.accent3 });
  doc.textRight(`${d.score} / ${MAX_STYLE_SCORE} · ${d.band}`, A4.width - M.right - pad, top + pad + 2, {
    font: 'Helvetica-Bold',
    size: 9,
    color: T.accent3,
  });

  let y = top + pad + 24;
  y = doc.paragraph(d.low, M.left + pad, y, textW, { size: 9.5, leading: 15, color: T.devInk });

  y += 12;
  doc.rect(M.left + pad, y, textW, actionH + 24, '#FFFFFF');
  doc.strokeRect(M.left + pad, y, textW, actionH + 24, T.accentLine, 0.6);
  doc.text('TRY THIS', M.left + pad + 12, y + 8, {
    font: 'Helvetica-Bold',
    size: 7,
    color: accent,
    charSpacing: 0.8,
  });
  doc.paragraph(d.action, M.left + pad + 12, y + 20, textW - 24, {
    size: 9.5,
    leading: 15,
    color: T.ink2,
  });

  cur.y = top + boxH + 20;
}

function drawFooters(doc: PdfDoc, report: ReportPayload): void {
  const total = doc.pageCount;
  for (let i = 0; i < total; i++) {
    doc.onPage(i, () => {
      const y = A4.height - 44;
      doc.hr(M.left, y, CONTENT_W, T.line, 0.6);
      doc.text(
        `Confidential — prepared for ${report.candidate.firstName} ${report.candidate.lastName}`.trim(),
        M.left,
        y + 10,
        { size: 7.5, color: T.ink4 },
      );
      doc.textCentre(report.branding.companyName, A4.width / 2, y + 10, { size: 7.5, color: T.ink4 });
      doc.textRight(`Page ${i + 1} of ${total}`, A4.width - M.right, y + 10, {
        size: 7.5,
        color: T.ink4,
      });
    });
  }
}

// -------------------------------------------------------------------- helpers

function truncate(value: string, font: Parameters<typeof measure>[1], size: number, maxWidth: number): string {
  if (measure(value, font, size) <= maxWidth) return value;
  let out = value;
  while (out.length > 1 && measure(out + '…', font, size) > maxWidth) out = out.slice(0, -1);
  return out + '…';
}

function formatDate(value: string): string {
  const d = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
