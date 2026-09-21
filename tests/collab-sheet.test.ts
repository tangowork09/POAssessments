import { describe, expect, it } from 'vitest';
import { COLLAB_ITEM_COUNT, COLLAB_SECTIONS } from '../src/shared/collab.js';
import { renderCollabSheetPdf } from '../src/worker/pdf/collab-onepager.js';
import { collabSheetEmail } from '../src/worker/email/collab-templates.js';

const BRANDING = {
  companyName: 'PO Assessments',
  accentColor: '#0B6FB4',
  logoDataUrl: '',
  supportEmail: 'support@example.com',
};

function sheetPayload(over: Partial<Parameters<typeof renderCollabSheetPdf>[0]> = {}) {
  return {
    organisation: 'Acme Pharma',
    waveName: 'September 2026',
    groupN: 12,
    sections: COLLAB_SECTIONS.map((s, i) => ({ short: s.short, you: 2 + i * 0.4, group: 3 })),
    apart: [
      { no: 14, you: 1, group: 3.4 },
      { no: 3, you: 5, group: 2.6 },
    ],
    branding: BRANDING,
    generatedAt: '2026-09-21',
    ...over,
  };
}

/**
 * The text the page actually draws, reassembled.
 *
 * Content streams hold one `(…) Tj` per drawn line, and PDF string literals
 * escape their parentheses — so a sentence that wraps is several fragments and
 * "(47 people)" is stored as "\(47 people\)". Searching the raw bytes finds
 * neither. The fragments are joined with a space, which is what a reader sees.
 */
function rawOf(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1');
}

function textOf(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString('latin1');
  const drawn = [...raw.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)].map((m) =>
    m[1]!.replace(/\\([()\\])/g, '$1'),
  );
  return drawn.join(' ');
}

describe('a participant’s own sheet', () => {
  it('is one page', () => {
    const raw = rawOf(renderCollabSheetPdf(sheetPayload()));
    expect(raw.startsWith('%PDF')).toBe(true);
    expect(/\/Count 1\b/.test(raw)).toBe(true);
  });

  it('says it is not a score, before the reader sees a number', () => {
    // A number handed to somebody without a reading is a number they read as a
    // grade, and this instrument does not grade anybody.
    const text = textOf(renderCollabSheetPdf(sheetPayload()));
    expect(text).toContain('not a score');
    expect(text).toContain('nobody is ranked by it');
    expect(text).toContain('not shown to anyone');
  });

  it('gives no total, no band and no position against colleagues', () => {
    const text = textOf(renderCollabSheetPdf(sheetPayload()));
    expect(text).not.toContain('/ 120');
    expect(text).not.toContain('Significant systemic barriers');
    expect(text).not.toContain('Healthy collaboration system');
    expect(text).not.toMatch(/\brank(ed|ing)? [0-9]/i);
  });

  it('names the group it compares against, with its size', () => {
    const text = textOf(renderCollabSheetPdf(sheetPayload({ groupN: 47 })));
    expect(text).toContain('The group (47 people)');
  });

  it('reads a divergence as a difference, not a fault, in both directions', () => {
    const text = textOf(renderCollabSheetPdf(sheetPayload()));
    expect(text).toContain('you read this more critically');
    expect(text).toContain('you read this more positively');
  });

  it('explains the conversion, so a 5 on this page is unambiguous', () => {
    const text = textOf(renderCollabSheetPdf(sheetPayload()));
    expect(text).toContain('6 minus the');
    expect(text).toContain('5 always means healthy');
  });

  it('renders when the person matched the group exactly', () => {
    const flat = COLLAB_SECTIONS.map((s) => ({ short: s.short, you: 3, group: 3 }));
    const bytes = renderCollabSheetPdf(sheetPayload({ sections: flat, apart: [] }));
    expect(rawOf(bytes).startsWith('%PDF')).toBe(true);
    expect(textOf(bytes)).toContain('not a score');
  });

  it('covers every section, so nothing the person answered is left out', () => {
    const text = textOf(renderCollabSheetPdf(sheetPayload()));
    for (const section of COLLAB_SECTIONS) expect(text).toContain(section.short);
    expect(COLLAB_SECTIONS).toHaveLength(6);
    expect(COLLAB_ITEM_COUNT).toBe(24);
  });
});

describe('the email that carries it', () => {
  const mail = collabSheetEmail({
    branding: BRANDING,
    logoUrl: 'https://example.test/api/logo',
    organisation: 'Acme Pharma',
    waveName: 'September 2026',
    groupN: 12,
    link: 'https://example.test/api/report/collab-sheet/tok',
  });

  it('leads with what this is not, before the reader opens a PDF with numbers in it', () => {
    expect(mail.subject).toBe('Your answers — Acme Pharma');
    expect(mail.html).toContain('not a score and not an assessment of you');
    expect(mail.text).toContain('nobody is ranked by it');
  });

  it('counts the others, not the reader, when describing the comparison', () => {
    // "what the other 11 people said" — the reader is not one of the others.
    expect(mail.html).toContain('other 11 people');
    expect(mail.text).toContain('other 11 people');
  });

  it('carries the link in both the html and the plain text', () => {
    expect(mail.html).toContain('/api/report/collab-sheet/tok');
    expect(mail.text).toContain('/api/report/collab-sheet/tok');
  });
});
