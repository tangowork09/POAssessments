import { describe, expect, it } from 'vitest';
import { COLLAB_ITEM_COUNT } from '../src/shared/collab.js';
import { collabTrend } from '../src/worker/lib/collab-trend.js';
import type { Env } from '../src/worker/env.js';

/**
 * A stub D1 that serves per-wave rows, so the trend can be asked the two
 * questions it exists for: did the organisation move, and did the same people
 * answer.
 */
function stubDb(waves: { no: number; label: string; answers: Record<number, number>[] }[]) {
  const env = {
    DB: {
      prepare(sql: string) {
        return {
          bind: (...binds: unknown[]) => ({
            all: async () => {
              if (/FROM cohort_rounds/.test(sql)) {
                return {
                  results: waves.map((w) => ({
                    no: w.no,
                    label: w.label,
                    opened_at: '2026-09-01',
                    closed_at: null,
                  })),
                };
              }
              const waveNo = Number(binds[1]);
              const wave = waves.find((w) => w.no === waveNo);
              if (!wave) return { results: [] };
              if (/SELECT id, anonymous/.test(sql)) {
                return { results: wave.answers.map((_, i) => ({ id: `r${waveNo}-${i}`, anonymous: 1 })) };
              }
              if (/FROM answers/.test(sql)) {
                return {
                  results: wave.answers.flatMap((sheet, i) =>
                    Object.entries(sheet).map(([no, value]) => ({
                      response_id: `r${waveNo}-${i}`,
                      no: Number(no),
                      value,
                    })),
                  ),
                };
              }
              return { results: [] };
            },
            first: async () => {
              if (/personal_links/.test(sql)) {
                const wave = waves.find((w) => w.no === Number(binds[1]));
                return {
                  personal_links: 0,
                  roster: 0,
                  started: wave?.answers.length ?? 0,
                  completed: wave?.answers.length ?? 0,
                };
              }
              return null;
            },
          }),
        };
      },
    },
  } as unknown as Env;
  return env;
}

function sheet(value: number): Record<number, number> {
  const answers: Record<number, number> = {};
  for (let no = 1; no <= COLLAB_ITEM_COUNT; no++) answers[no] = value;
  return answers;
}

const NAMES = new Map([
  ['structure', 'Structure & Goals'],
  ['barriers', 'Collaboration Barriers'],
  ['trust', 'Trust & Safety'],
  ['power', 'Power & Escalation'],
  ['pressure', 'Operational & Compliance'],
  ['levers', 'Institutional Levers'],
]);

describe('wave over wave', () => {
  it('has nothing to compare from one wave', async () => {
    const env = stubDb([{ no: 1, label: '', answers: [sheet(3), sheet(3)] }]);
    const trend = await collabTrend(env, 'co1', NAMES);
    expect(trend.waves).toHaveLength(1);
    expect(trend.waves[0]!.label).toBe('Wave 1'); // unlabelled waves get their number
    expect(trend.latest).toBeNull();
  });

  it('measures the movement between the last two scored waves', async () => {
    const env = stubDb([
      { no: 1, label: 'September', answers: [sheet(2), sheet(2)] },
      { no: 2, label: 'March', answers: [sheet(3), sheet(3)] },
    ]);
    const trend = await collabTrend(env, 'co1', NAMES);
    expect(trend.latest).not.toBeNull();
    expect(trend.latest!.fromWave).toBe(1);
    expect(trend.latest!.toWave).toBe(2);
    // An all-3 sheet converts to 3 everywhere; an all-2 sheet does not, because
    // fourteen statements are reversed. The engine, not the test, works it out.
    expect(trend.latest!.totalDelta).toBe(trend.waves[1]!.total! - trend.waves[0]!.total!);
    expect(trend.latest!.sections).toHaveLength(6);
    expect(trend.latest!.sections[0]!.short).toBe(NAMES.get(trend.latest!.sections[0]!.key));
  });

  it('carries the participation behind a movement, because it qualifies it', async () => {
    const env = stubDb([
      { no: 1, label: 'September', answers: Array.from({ length: 40 }, () => sheet(2)) },
      { no: 2, label: 'March', answers: [sheet(5)] },
    ]);
    const trend = await collabTrend(env, 'co1', NAMES);
    // A leap from 40 respondents to 1 is not an improvement, and the figures
    // that say who answered have to travel with the one that says it rose.
    expect(trend.latest!.fromN).toBe(40);
    expect(trend.latest!.toN).toBe(1);
  });

  it('keeps a wave nobody answered rather than closing the gap in the record', async () => {
    const env = stubDb([
      { no: 1, label: 'September', answers: [sheet(3)] },
      { no: 2, label: 'Abandoned', answers: [] },
      { no: 3, label: 'March', answers: [sheet(4)] },
    ]);
    const trend = await collabTrend(env, 'co1', NAMES);
    expect(trend.waves.map((w) => w.label)).toEqual(['September', 'Abandoned', 'March']);
    expect(trend.waves[1]!.total).toBeNull();
    expect(trend.waves[1]!.n).toBe(0);
    // The comparison skips it: an empty wave is not the previous reading.
    expect(trend.latest!.fromWave).toBe(1);
    expect(trend.latest!.toWave).toBe(3);
  });

  it('ranks statement movement in both directions', async () => {
    const worse = { ...sheet(3), 1: 5 };
    const better = { ...sheet(3), 1: 1 };
    const env = stubDb([
      { no: 1, label: 'September', answers: [worse, worse] },
      { no: 2, label: 'March', answers: [better, better] },
    ]);
    const trend = await collabTrend(env, 'co1', NAMES);
    // Statement 1 is direct, so answering 1 instead of 5 is a fall of four.
    expect(trend.latest!.worsened[0]).toMatchObject({ no: 1, delta: -4 });
    expect(trend.latest!.improved).toHaveLength(0);
  });
});
