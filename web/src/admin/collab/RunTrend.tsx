/**
 * How the organisation has moved between waves.
 *
 * Participation is printed beside every movement rather than in a footnote. A
 * section mean that rose while half the leadership stopped answering has not
 * risen — it has changed who was asked — and a facilitator reading a green
 * number needs that in the same glance, not two clicks away.
 */

import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api.js';
import { CardHead, Loading } from '../ui.js';

interface Move {
  key: string;
  short: string;
  from: number;
  to: number;
  delta: number;
}

interface Trend {
  waves: {
    no: number;
    label: string;
    n: number;
    invited: number;
    total: number | null;
    perItem: number | null;
    bandName: string | null;
  }[];
  latest: {
    fromWave: number;
    toWave: number;
    totalDelta: number;
    perItemDelta: number;
    fromN: number;
    toN: number;
    sections: Move[];
    improved: { no: number; from: number; to: number; delta: number }[];
    worsened: { no: number; from: number; to: number; delta: number }[];
  } | null;
}

function signed(value: number, digits = 2): string {
  return `${value > 0 ? '+' : value < 0 ? '−' : '±'}${Math.abs(value).toFixed(digits)}`;
}

function moveClass(delta: number): string {
  if (delta > 0.05) return 'cd-up';
  if (delta < -0.05) return 'cd-down';
  return 'cd-flat';
}

export function RunTrend({ runId }: { runId: string }) {
  const [trend, setTrend] = useState<Trend | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .get<Trend>(`/api/admin/collab-runs/${runId}/trend`)
      .then((t) => live && setTrend(t))
      .catch((err: unknown) => live && setError(err instanceof ApiError ? err.message : 'Could not load the trend.'));
    return () => {
      live = false;
    };
  }, [runId]);

  if (error) return null;
  if (!trend) return <Loading label="Comparing waves…" />;
  // One wave is not a trend, and drawing an empty panel implies it should be.
  if (trend.waves.length < 2) return null;

  const { latest } = trend;

  return (
    <section className="card mt-5">
      <CardHead
        title="Wave over wave"
        sub="What has changed since the previous wave, and how many people answered each time."
      />

      <div className="cd-matrix card-body">
        <table>
          <thead>
            <tr>
              <th>Wave</th>
              <th>Answered</th>
              <th>Index</th>
              <th>Per statement</th>
              <th>Band</th>
            </tr>
          </thead>
          <tbody>
            {trend.waves.map((w) => (
              <tr key={w.no}>
                <td>{w.label}</td>
                <td className="num">
                  {w.n}
                  {w.invited > 0 ? ` of ${w.invited}` : ''}
                </td>
                <td className="num">{w.total ?? '—'}</td>
                <td className="num">{w.perItem?.toFixed(2) ?? '—'}</td>
                <td>{w.bandName ?? 'Not scored'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {latest && (
        <div className="card-body">
          <p className="cd-move-head">
            <b className={moveClass(latest.perItemDelta)}>
              {signed(latest.totalDelta, 0)} on the index
            </b>{' '}
            from wave {latest.fromWave} to wave {latest.toWave} ({signed(latest.perItemDelta)} per statement).
          </p>
          <p className="hint">
            {latest.toN === latest.fromN
              ? `The same number of people answered both waves: ${latest.toN}.`
              : `${latest.fromN} ${latest.fromN === 1 ? 'person' : 'people'} answered the earlier wave and ` +
                `${latest.toN} answered this one. ` +
                (latest.toN < latest.fromN
                  ? 'Fewer respondents means part of this movement is a change in who was asked, not a change in the organisation.'
                  : 'More people answered this time, so part of this movement is a change in who was asked.')}
          </p>

          <ul className="cd-moves">
            {latest.sections.map((m) => (
              <li key={m.key}>
                <span className="cd-move-name">{m.short}</span>
                <span className="num cd-move-from">
                  {m.from.toFixed(2)} → {m.to.toFixed(2)}
                </span>
                <span className={`num cd-move-delta ${moveClass(m.delta)}`}>{signed(m.delta)}</span>
              </li>
            ))}
          </ul>

          {(latest.improved.length > 0 || latest.worsened.length > 0) && (
            <p className="hint mt-3">
              {latest.improved.length > 0 && (
                <>
                  Most improved: {latest.improved.map((m) => `statement ${m.no} (${signed(m.delta)})`).join(', ')}.{' '}
                </>
              )}
              {latest.worsened.length > 0 && (
                <>Fallen furthest: {latest.worsened.map((m) => `statement ${m.no} (${signed(m.delta)})`).join(', ')}.</>
              )}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
