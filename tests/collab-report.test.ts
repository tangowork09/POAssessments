import { describe, expect, it } from 'vitest';
import { COLLAB_ITEM_COUNT } from '../src/shared/collab.js';
import { scoreCollabGroup, segmentCollab } from '../src/shared/collab-scoring.js';
import { renderCollabReportPdf, type CollabReportPayload } from '../src/worker/pdf/collab-report.js';

/**
 * The report is read months later by people who were not in the room, so these
 * tests assert on what it *says*, not only that it renders. Content streams are
 * uncompressed, so the drawn text is searchable in the bytes.
 */
function textOf(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1');
}

function sheet(value: number): Record<number, number> {
  const answers: Record<number, number> = {};
  for (let no = 1; no <= COLLAB_ITEM_COUNT; no++) answers[no] = value;
  return answers;
}

const BRANDING = {
  companyName: 'PO Assessments',
  accentColor: '#0B6FB4',
  logoDataUrl: '',
  supportEmail: 'support@example.com',
};

function payload(
  responses: Record<number, number>[],
  over: Partial<CollabReportPayload> = {},
): CollabReportPayload {
  const group = scoreCollabGroup(responses);
  return {
    runName: 'Acme Pharma leadership',
    organisation: 'Acme Pharma',
    waveName: 'September 2026',
    n: group.n,
    incomplete: group.incomplete,
    invited: 0,
    anonymous: true,
    minSegment: 5,
    total: group.total,
    perItem: group.perItem,
    bandKey: group.band.key,
    bandName: group.band.name,
    bandReading: group.band.reading,
    sections: group.sections.map((s) => ({ key: s.key, short: s.short, mean: s.mean, spread: s.spread })),
    items: group.items,
    gap: { strongest: 'Structure & Goals', weakest: 'Institutional Levers', value: group.gap.value },
    attention: group.attention,
    strengths: group.strengths,
    split: group.split,
    cuts: [],
    branding: BRANDING,
    generatedAt: '2026-09-21',
    ...over,
  };
}

describe('the facilitator report', () => {
  it('renders a multi-page PDF', () => {
    const bytes = renderCollabReportPdf(payload([sheet(3), sheet(4), sheet(2)]));
    const text = textOf(bytes);
    expect(text.startsWith('%PDF-1.7')).toBe(true);
    expect(text).toContain('/Type /Pages');
    const pages = Number(/\/Count (\d+)/.exec(text)?.[1] ?? 0);
    expect(pages).toBeGreaterThan(3);
  });

  it('says what it is before it says any number', () => {
    const text = textOf(renderCollabReportPdf(payload([sheet(3), sheet(3)])));
    expect(text).toContain('not an assessment of the people in it');
    expect(text).toContain('No');
    expect(text).toContain('Confidential');
  });

  it('explains the conversion, because a mean of reversed items is unreadable without it', () => {
    const text = textOf(renderCollabReportPdf(payload([sheet(3), sheet(3)])));
    expect(text).toContain('6 minus the answer');
    expect(text).toContain('5 always means healthy');
  });

  it('carries the master copy’s caution about the bands and the sample', () => {
    const text = textOf(renderCollabReportPdf(payload([sheet(3), sheet(3)])));
    expect(text).toContain('indicative guide');
    expect(text).toContain('not a benchmark');
  });

  it('flags a split statement where the group is loaded at both ends', () => {
    const split = [
      ...Array.from({ length: 6 }, () => ({ ...sheet(3), 1: 1 })),
      ...Array.from({ length: 6 }, () => ({ ...sheet(3), 1: 5 })),
    ];
    const text = textOf(renderCollabReportPdf(payload(split)));
    expect(text).toContain('SPLIT');
    expect(text).toContain('does not agree');
  });

  it('names a withheld segment and gives the reason', () => {
    const responses = [
      ...Array.from({ length: 6 }, () => sheet(4)),
      ...Array.from({ length: 3 }, () => sheet(2)),
    ];
    const cuts = [
      {
        label: 'Department',
        segments: segmentCollab(
          [
            { name: 'Operations', responses: responses.slice(0, 6) },
            { name: 'Quality & QA', responses: responses.slice(6) },
          ],
          5,
        ),
      },
    ];
    const text = textOf(renderCollabReportPdf(payload(responses, { cuts })));
    expect(text).toContain('Quality & QA');
    expect(text).toContain('Not reported');
    expect(text).toContain('identify who said what');
  });

  it('says a shared-link run has no response rate rather than printing 100%', () => {
    const text = textOf(renderCollabReportPdf(payload([sheet(3), sheet(3)], { invited: 0 })));
    expect(text).toContain('Answered through a shared link');
  });

  it('reports a rate when a facilitator actually invited people', () => {
    const text = textOf(renderCollabReportPdf(payload([sheet(3), sheet(3)], { invited: 4 })));
    expect(text).toContain('50% of 4 invited');
  });

  it('renders from a single response, where there is no spread to draw', () => {
    const bytes = renderCollabReportPdf(payload([sheet(3)]));
    expect(textOf(bytes).startsWith('%PDF')).toBe(true);
  });

  it('accounts for sheets left unfinished rather than dropping them silently', () => {
    const text = textOf(renderCollabReportPdf(payload([sheet(3), sheet(3)], { incomplete: 2 })));
    expect(text).toContain('left unfinished');
  });
});
