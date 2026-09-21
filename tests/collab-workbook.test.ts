import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { COLLAB_ITEMS, COLLAB_ITEM_COUNT } from '../src/shared/collab.js';
import { scoreCollabGroup, segmentCollab } from '../src/shared/collab-scoring.js';
import { buildCollabWorkbook } from '../src/worker/lib/collab-workbook.js';
import type { CollabRunScores } from '../src/worker/lib/collab-run.js';

/** A sheet answered the same way throughout. */
function sheet(value: number): Record<number, number> {
  const answers: Record<number, number> = {};
  for (let no = 1; no <= COLLAB_ITEM_COUNT; no++) answers[no] = value;
  return answers;
}

/** A group where item 1 splits the room and everything else is a 3. */
function splitOn(no: number, low: number, high: number): Record<number, number>[] {
  return [
    ...Array.from({ length: low }, () => ({ ...sheet(3), [no]: 1 })),
    ...Array.from({ length: high }, () => ({ ...sheet(3), [no]: 5 })),
  ];
}

function scores(responses: Record<number, number>[], segments: { name: string; n: number }[]): CollabRunScores {
  let taken = 0;
  return {
    group: scoreCollabGroup(responses),
    cuts: [
      {
        key: 'department',
        label: 'Department',
        segments: segmentCollab(
          segments.map((s) => {
            const slice = responses.slice(taken, taken + s.n);
            taken += s.n;
            return { name: s.name, responses: slice };
          }),
          5,
        ),
      },
    ],
    turnout: { invited: 0, started: responses.length, completed: responses.length },
  };
}

async function read(buffer: ArrayBuffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb;
}

function textOf(ws: ExcelJS.Worksheet): string {
  const parts: string[] = [];
  ws.eachRow((row) => {
    for (const value of row.values as unknown[]) {
      if (value !== null && value !== undefined) parts.push(String(value));
    }
  });
  return parts.join(' | ');
}

const INPUT = {
  runName: 'Acme Pharma leadership',
  organisation: 'Acme Pharma',
  waveNo: 1,
  waveName: 'September 2026',
  anonymous: true,
  minSegment: 5,
};

describe('the run workbook', () => {
  it('has the four sheets a facilitator works through, in order', async () => {
    const wb = await read(await buildCollabWorkbook({ ...INPUT, scores: scores(splitOn(1, 6, 6), [{ name: 'Operations', n: 12 }]) }));
    expect(wb.worksheets.map((ws) => ws.name)).toEqual(['Summary', 'Statements', 'By segment', 'Method']);
  });

  it('carries the index, its band and the sections ranked', async () => {
    const wb = await read(await buildCollabWorkbook({ ...INPUT, scores: scores([sheet(3), sheet(3), sheet(3)], [{ name: 'Operations', n: 3 }]) }));
    const summary = textOf(wb.getWorksheet('Summary')!);
    expect(summary).toContain('Acme Pharma leadership');
    expect(summary).toContain('September 2026');
    expect(summary).toContain('Anonymous responses');
    expect(summary).toContain('Total index (24-120)');
    expect(summary).toContain('72'); // 24 statements at a converted 3
    expect(summary).toContain('Workable, with real friction');
  });

  it('says a shared-link run has no response rate rather than inventing one', async () => {
    const wb = await read(await buildCollabWorkbook({ ...INPUT, scores: scores([sheet(3), sheet(3)], [{ name: 'Operations', n: 2 }]) }));
    const summary = textOf(wb.getWorksheet('Summary')!);
    expect(summary).toContain('no invited total');
    expect(summary).not.toContain('Response rate');
  });

  it('marks which statements were reversed, so a mean cannot be read the wrong way', async () => {
    const wb = await read(await buildCollabWorkbook({ ...INPUT, scores: scores([sheet(3), sheet(3)], [{ name: 'Operations', n: 2 }]) }));
    const ws = wb.getWorksheet('Statements')!;
    const reverse = COLLAB_ITEMS.find((i) => i.direction === 'reverse')!;
    const direct = COLLAB_ITEMS.find((i) => i.direction === 'direct')!;
    const scoredFor = (no: number) => {
      let found = '';
      ws.eachRow((row) => {
        if (row.getCell(1).value === no) found = String(row.getCell(4).value);
      });
      return found;
    };
    expect(scoredFor(reverse.no)).toContain('Reverse');
    expect(scoredFor(direct.no)).toBe('Direct');
  });

  it('flags a split statement and prints the counts behind it', async () => {
    const wb = await read(
      await buildCollabWorkbook({ ...INPUT, scores: scores(splitOn(1, 6, 6), [{ name: 'Operations', n: 12 }]) }),
    );
    const ws = wb.getWorksheet('Statements')!;
    let row: ExcelJS.Row | null = null;
    ws.eachRow((r) => {
      if (r.getCell(1).value === 1) row = r;
    });
    expect(row).not.toBeNull();
    expect(row!.getCell(9).value).toBe('Yes');
    // Six at each end, nothing in the middle: the shape the mean hides.
    expect([10, 11, 12, 13, 14].map((c) => row!.getCell(c).value)).toEqual([6, 0, 0, 0, 6]);
  });

  it('keeps a suppressed segment as a row, with its count and the reason', async () => {
    const responses = [...Array.from({ length: 6 }, () => sheet(4)), ...Array.from({ length: 3 }, () => sheet(2))];
    const wb = await read(
      await buildCollabWorkbook({
        ...INPUT,
        scores: scores(responses, [
          { name: 'Operations', n: 6 },
          { name: 'Quality & QA', n: 3 },
        ]),
      }),
    );
    const segment = textOf(wb.getWorksheet('By segment')!);
    expect(segment).toContain('Operations');
    expect(segment).toContain('Quality & QA'); // named, not dropped
    expect(segment).toContain('under the floor of 5');
  });

  it('explains the conversion, the floor and the caution on the method sheet', async () => {
    const wb = await read(await buildCollabWorkbook({ ...INPUT, scores: scores([sheet(3), sheet(3)], [{ name: 'Operations', n: 2 }]) }));
    const method = textOf(wb.getWorksheet('Method')!);
    // These numbers get forwarded to people who were not at the debrief.
    expect(method).toContain('6 minus the answer');
    expect(method).toContain('fewer than 5 respondents');
    expect(method).toContain('indicative guide, not a hard cut-off');
    expect(method).toContain('96–120');
  });
});
