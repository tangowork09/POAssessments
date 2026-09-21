/**
 * Where this organisation sits among the others that opted in.
 *
 * The second question every client asks, after "how did we do": is this
 * normal? It is answerable because the same 24 statements have been put to
 * several organisations, and it is shown carefully because it is built out of
 * other people's confidential diagnostics.
 *
 * Nothing is drawn until enough organisations have opted in, and when it is
 * withheld the panel says why rather than disappearing — a facilitator who
 * cannot see a comparison should know whether it is missing or refused.
 */

import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

interface BenchSection {
  key: string;
  short: string;
  you: number | null;
  median: number;
  low: number;
  high: number;
}

interface Benchmark {
  orgs: number;
  sections: BenchSection[] | null;
  you: { total: number; perItem: number } | null;
  median: { total: number; perItem: number } | null;
  withheld: string | null;
}

/** A 1..5 value's place on the track, which starts at 1 like the instrument. */
const pos = (v: number) => ((v - 1) / 4) * 100;

export function RunBenchmark({ runId }: { runId: string }) {
  const [bench, setBench] = useState<Benchmark | null>(null);

  useEffect(() => {
    let live = true;
    api
      .get<Benchmark>(`/api/admin/collab-runs/${runId}/benchmark`)
      .then((b) => live && setBench(b))
      .catch(() => live && setBench(null));
    return () => {
      live = false;
    };
  }, [runId]);

  // Nothing at all when this run is not in the benchmark and none exists: an
  // empty panel about a feature nobody switched on is noise.
  if (!bench || (bench.withheld && bench.orgs === 0)) return null;

  return (
    <section className="cd-sec">
      <div className="cd-sec-head">
        <h3>Against other organisations</h3>
        <p>
          {bench.withheld
            ? bench.withheld
            : `The middle and the range across ${bench.orgs} organisations that agreed to be compared. No organisation is named, and this is what these ${bench.orgs} looked like rather than an industry norm.`}
        </p>
      </div>

      {bench.sections && (
        <div className="cd-panel cd-bench">
          <div className="cd-bench-head">
            <span style={{ width: 180 }}>Section</span>
            <span style={{ flex: 1 }}>Range across organisations</span>
            <span>You</span>
            <span>Middle</span>
          </div>
          {bench.sections.map((s) => (
            <div className="cd-bench-row" key={s.key}>
              <span>{s.short}</span>
              <span
                className="cd-bench-range"
                role="img"
                aria-label={`${s.short}: this organisation ${s.you?.toFixed(2) ?? 'not scored'}, middle ${s.median.toFixed(2)}, range ${s.low.toFixed(2)} to ${s.high.toFixed(2)}`}
              >
                <span
                  className="band"
                  style={{ left: `${pos(s.low)}%`, width: `${Math.max(1, pos(s.high) - pos(s.low))}%` }}
                />
                <span className="med" style={{ left: `${pos(s.median)}%` }} />
                {s.you !== null && <span className="you" style={{ left: `${pos(s.you)}%` }} />}
              </span>
              <span className="num">{s.you === null ? '—' : s.you.toFixed(2)}</span>
              <span className="num muted">{s.median.toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
