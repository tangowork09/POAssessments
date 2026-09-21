/**
 * How one organisation compares with the others this consultancy has run.
 *
 * The question every client asks second, after "how did we do": is this
 * normal? It is answerable here because the same 24 statements have been put
 * to several organisations, and worth answering carefully because the answer
 * is built out of other people's confidential diagnostics.
 *
 * Three rules hold it to something defensible.
 *
 *   Consent. A run counts towards a benchmark only if that organisation's run
 *   was marked as opting in. A client who answered a confidential diagnostic
 *   did not thereby agree to become a line in somebody else's report, and the
 *   default is off.
 *
 *   A floor. Below `MIN_ORGS` opted-in organisations, nothing is reported at
 *   all. With two, "the benchmark" is one other company and the reader can
 *   work out which — and with three, a range still points at individuals'
 *   employers in a small market.
 *
 *   No names, ever. The comparison is a median and a range across
 *   organisations. Which organisation sits where is exactly what this must
 *   not say, and the payload has no field that could carry it.
 *
 * It is also not a norm. A median of nine pharma clients is what nine clients
 * of one consultancy looked like, and the report says so rather than letting
 * it be read as an industry standard.
 */

import type { Env } from '../env.js';
import { scoreCollabGroup } from '../../shared/collab-scoring.js';
import { COLLAB_SECTIONS } from '../../shared/collab.js';
import { ASSESSMENT_ID } from '../../shared/assessments.js';
import { loadRunResponses } from './collab-run.js';

/** Fewest opted-in organisations before a comparison may be shown. */
export const MIN_ORGS = 4;

export interface BenchmarkSection {
  key: string;
  short: string;
  /** This organisation's mean, or null when it is not the subject. */
  you: number | null;
  median: number;
  low: number;
  high: number;
}

export interface Benchmark {
  /** How many organisations the comparison is built from. */
  orgs: number;
  /** Null when the floor is not met: nothing is reported, and why. */
  sections: BenchmarkSection[] | null;
  you: { total: number; perItem: number } | null;
  median: { total: number; perItem: number } | null;
  withheld: string | null;
}

interface OrgReading {
  cohortId: string;
  perItem: number;
  total: number;
  sections: Map<string, number>;
}

export async function collabBenchmark(env: Env, subjectCohortId: string | null): Promise<Benchmark> {
  const { results } = await env.DB.prepare(
    `SELECT co.id,
            (SELECT rd.no FROM cohort_rounds rd
              WHERE rd.cohort_id = co.id ORDER BY (rd.closed_at IS NULL) DESC, rd.no DESC LIMIT 1) AS round_no
       FROM cohorts co
      WHERE co.assessment_id = ?1 AND co.benchmark_opt_in = 1 AND co.archived = 0`,
  )
    .bind(ASSESSMENT_ID.collab)
    .all<{ id: string; round_no: number | null }>();

  const readings: OrgReading[] = [];
  for (const row of results ?? []) {
    const responses = await loadRunResponses(env, row.id, row.round_no ?? 1);
    if (responses.length === 0) continue;
    try {
      const group = scoreCollabGroup(responses.map((r) => r.answers));
      readings.push({
        cohortId: row.id,
        perItem: group.perItem,
        total: group.total,
        sections: new Map(group.sections.map((s) => [s.key, s.mean])),
      });
    } catch {
      // A run where nothing is complete is not an organisation's reading.
    }
  }

  const subject = subjectCohortId ? readings.find((r) => r.cohortId === subjectCohortId) ?? null : null;

  if (readings.length < MIN_ORGS) {
    return {
      orgs: readings.length,
      sections: null,
      you: subject ? { total: subject.total, perItem: subject.perItem } : null,
      median: null,
      withheld: `A comparison needs at least ${MIN_ORGS} organisations that have opted in. There ${
        readings.length === 1 ? 'is 1' : `are ${readings.length}`
      }, so nothing is shown: with fewer, the reader can work out whose figures they are looking at.`,
    };
  }

  const sections: BenchmarkSection[] = COLLAB_SECTIONS.map((section) => {
    const values = readings
      .map((r) => r.sections.get(section.key))
      .filter((v): v is number => v !== undefined)
      .sort((a, b) => a - b);
    return {
      key: section.key,
      short: section.short,
      you: subject?.sections.get(section.key) ?? null,
      median: median(values),
      low: values[0] ?? 0,
      high: values[values.length - 1] ?? 0,
    };
  });

  return {
    orgs: readings.length,
    sections,
    you: subject ? { total: subject.total, perItem: subject.perItem } : null,
    median: {
      total: Math.round(median(readings.map((r) => r.total).sort((a, b) => a - b))),
      perItem: median(readings.map((r) => r.perItem).sort((a, b) => a - b)),
    },
    withheld: null,
  };
}

function median(sorted: readonly number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
  return Math.round(value * 100) / 100;
}
