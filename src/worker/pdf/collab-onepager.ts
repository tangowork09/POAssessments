/**
 * One leader's own sheet: what they said, against what the group said.
 *
 * A single page, and it is not a score. Nobody is diagnosed by this
 * instrument, so the sheet never gives the reader a total, a band, or a
 * position against their colleagues. What it gives them is the thing they
 * cannot get anywhere else: where their own reading of the organisation sits
 * apart from everyone else's.
 *
 * That is the whole design. A leader who marked Trust & Safety two points
 * below the group is not wrong and is not a low scorer — they are seeing
 * something the group is not, or the group is seeing something they are not,
 * and either way it is worth a conversation. The page says so in those words,
 * because a number handed to someone without a reading is a number they will
 * read as a grade.
 */

import { BRAND_COMPANY_NAME } from '../../shared/brand.js';
import { COLLAB_ITEM_BY_NO } from '../../shared/collab.js';
import type { Branding } from '../../shared/types.js';
import type { EmbeddedImage } from './image.js';
import { A4, PdfDoc, measure, wrap } from './writer.js';

const T = {
  ink: '#0C1421',
  ink2: '#3D4859',
  ink3: '#616C80',
  ink4: '#8D97A6',
  line: '#E4E8EE',
  line2: '#D3DAE3',
  surface: '#FAFBFC',
  track: '#EDF1F6',
  you: '#0B6FB4',
  group: '#8D97A6',
} as const;

const M = { left: 52, right: 52, top: 50, bottom: 52 };
const CONTENT_W = A4.width - M.left - M.right;
const RIGHT = A4.width - M.right;

export interface SheetSection {
  short: string;
  /** This respondent's converted mean for the section, 1..5. */
  you: number;
  /** The group's converted mean, 1..5. */
  group: number;
}

export interface SheetItem {
  no: number;
  you: number;
  group: number;
}

export interface CollabSheetPayload {
  organisation: string;
  waveName: string;
  /** How many people the group figure is made of. */
  groupN: number;
  sections: SheetSection[];
  /** The statements this person read most differently from everyone else. */
  apart: SheetItem[];
  branding: Branding;
  generatedAt: string;
}

export function renderCollabSheetPdf(
  sheet: CollabSheetPayload,
  logo: EmbeddedImage | null = null,
): Uint8Array {
  const doc = new PdfDoc(A4, {
    title: `Your answers — ${sheet.organisation}`,
    author: sheet.branding.companyName || BRAND_COMPANY_NAME,
    subject: 'Your own answers, against the group',
  });

  let y = M.top;

  if (logo) {
    const scale = Math.min((CONTENT_W * 0.3) / logo.width, 38 / logo.height);
    doc.image(logo, M.left, y, logo.width * scale, logo.height * scale);
    y += logo.height * scale + 26;
  } else {
    doc.text(sheet.branding.companyName || BRAND_COMPANY_NAME, M.left, y, {
      font: 'Helvetica-Bold',
      size: 12,
      color: T.ink,
    });
    y += 30;
  }

  doc.text('YOUR ANSWERS', M.left, y, {
    font: 'Helvetica-Bold',
    size: 8,
    color: T.ink4,
    charSpacing: 1.5,
  });
  y += 20;
  doc.text(sheet.organisation, M.left, y, { font: 'Helvetica-Bold', size: 22, color: T.ink });
  y += 28;
  doc.text(`Collaboration Diagnostic · ${sheet.waveName}`, M.left, y, { size: 10, color: T.ink3 });
  y += 26;
  doc.hr(M.left, y, CONTENT_W, T.line2);
  y += 20;

  y = para(
    doc,
    'This is your own copy of what you said, next to what the group said. It is not a score and not ' +
      'an assessment of you: the diagnostic measures how the organisation works, and nobody is ' +
      'ranked by it. Your individual answers were not shown to anyone.',
    y,
  );
  y += 8;
  y = para(
    doc,
    'Where your line sits apart from the group is the interesting part. It usually means you are ' +
      'seeing something they are not, or they are seeing something you are not, and both are worth ' +
      'raising in the debrief.',
    y,
  );
  y += 20;

  // The legend, before the first mark that uses it.
  doc.roundRect(M.left, y + 1, 18, 7, 3.5, T.you);
  doc.text('You', M.left + 24, y, { size: 8.6, color: T.ink2 });
  const groupX = M.left + 24 + measure('You', 'Helvetica', 8.6) + 18;
  doc.rect(groupX, y - 1, 1.6, 11, T.group);
  doc.text(`The group (${sheet.groupN} people)`, groupX + 8, y, { size: 8.6, color: T.ink2 });
  y += 24;

  const labelW = 148;
  const trackX = M.left + labelW;
  const trackW = CONTENT_W - labelW - 80;

  for (const section of sheet.sections) {
    doc.text(section.short, M.left, y + 1, { size: 9.2, color: T.ink });

    doc.roundRect(trackX, y + 4, trackW, 8, 4, T.track);
    doc.roundRect(trackX, y + 4, ((section.you - 1) / 4) * trackW, 8, 4, T.you);

    // The group as a line across the bar, so the comparison is one glance.
    const gx = trackX + ((section.group - 1) / 4) * trackW;
    doc.rect(gx - 0.8, y, 1.6, 16, T.group);

    doc.textRight(section.you.toFixed(1), RIGHT - 34, y + 1, {
      font: 'Helvetica-Bold',
      size: 9.2,
      color: T.you,
    });
    doc.textRight(section.group.toFixed(1), RIGHT, y + 1, { size: 9.2, color: T.ink3 });
    y += 26;
  }

  doc.text('1', trackX, y, { size: 7, color: T.ink4 });
  doc.textRight('5', trackX + trackW, y, { size: 7, color: T.ink4 });
  doc.textRight('you', RIGHT - 34, y, { size: 7, color: T.you });
  doc.textRight('group', RIGHT, y, { size: 7, color: T.ink4 });
  y += 28;

  if (sheet.apart.length > 0) {
    doc.text('Where you read it most differently', M.left, y, {
      font: 'Helvetica-Bold',
      size: 11,
      color: T.ink,
    });
    y += 18;

    for (const item of sheet.apart) {
      const statement = COLLAB_ITEM_BY_NO.get(item.no);
      if (!statement) continue;
      const lines = wrap(statement.text, 'Helvetica', 8.8, CONTENT_W - 130);
      const h = Math.max(34, lines.length * 12 + 16);

      doc.roundRect(M.left, y, CONTENT_W, h, 5, T.surface);
      let ty = y + 9;
      for (const line of lines) {
        doc.text(line, M.left + 12, ty, { size: 8.8, color: T.ink2 });
        ty += 12;
      }
      const gap = item.you - item.group;
      doc.textRight(`you ${item.you.toFixed(0)}`, RIGHT - 60, y + 9, {
        font: 'Helvetica-Bold',
        size: 9,
        color: T.you,
      });
      doc.textRight(`group ${item.group.toFixed(1)}`, RIGHT - 12, y + 9, { size: 9, color: T.ink3 });
      doc.textRight(
        gap > 0 ? 'you read this more positively' : 'you read this more critically',
        RIGHT - 12,
        y + 22,
        { size: 7.4, color: T.ink4 },
      );
      y += h + 8;
    }
  }

  y += 6;
  doc.hr(M.left, y, CONTENT_W, T.line);
  y += 14;
  para(
    doc,
    'Ten of the 24 statements describe good practice and fourteen describe problems. Every problem ' +
      'statement is converted with 6 minus the answer before anything is compared, so on this page a ' +
      '5 always means healthy, whichever way the statement was worded.',
    y,
    { size: 8, color: T.ink4, leading: 12 },
  );

  return doc.build();
}

function para(
  doc: PdfDoc,
  text: string,
  y: number,
  opts: { size?: number; leading?: number; color?: string } = {},
): number {
  const size = opts.size ?? 9.6;
  const leading = opts.leading ?? 14.6;
  let cursor = y;
  for (const line of wrap(text, 'Helvetica', size, CONTENT_W)) {
    doc.text(line, M.left, cursor, { size, color: opts.color ?? T.ink2 });
    cursor += leading;
  }
  return cursor;
}
