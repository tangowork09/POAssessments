/**
 * Assessments panel. The table is driven entirely by the assessments table, so
 * a second instrument appears here the moment its rows are inserted — there is
 * nothing to change in this file.
 */

import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { CardHead, EmptyState, ErrorState, Head, Loading, StatusPill } from './ui.js';
import { STYLES } from '../../../src/shared/styles.js';
import { MAX_STYLE_SCORE } from '../../../src/shared/scoring.js';

interface Row {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: string;
  question_count: number;
  invited: number;
  started: number;
  completed: number;
}

export function Assessments() {
  const [rows, setRows] = useState<Row[] | null>(null);
  // The API owns the scale; the shared constant is only a floor.
  const [maxStyleScore, setMaxStyleScore] = useState(MAX_STYLE_SCORE);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api
      .get<{ assessments: Row[]; maxStyleScore?: number }>('/api/admin/assessments')
      .then((r) => {
        setRows(r.assessments);
        if (r.maxStyleScore) setMaxStyleScore(r.maxStyleScore);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  return (
    <>
      <Head
        title="Assessments"
        sub="Every instrument on the platform, with its funnel. Adding one is a data change, not a deploy."
      />

      <section className="card">
        {error ? (
          <ErrorState message={error} onRetry={load} />
        ) : !rows ? (
          <Loading label="Loading assessments…" />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No assessments configured"
            body="Instruments live in the database. Once one is seeded it appears here with its questions and funnel."
          />
        ) : (
          <div className="table-scroll">
            <table className="table-funnel">
              <thead>
                <tr>
                  <th>Assessment</th>
                  <th>Status</th>
                  <th className="right">Questions</th>
                  <th className="right">Invited</th>
                  <th className="right">Started</th>
                  <th className="right">Completed</th>
                  <th className="right">Completed of started</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td className="name">
                      {a.name}
                      <span className="cell-sub">{a.description}</span>
                    </td>
                    <td>
                      <StatusPill status={a.status} />
                    </td>
                    <td className="right num">{a.question_count}</td>
                    <td className="right num">{a.invited}</td>
                    <td className="right num">{a.started}</td>
                    <td className="right num">{a.completed}</td>
                    <td className="right num">
                      {a.started > 0 ? `${Math.round((a.completed / a.started) * 100)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card mt-4">
        <CardHead
          title="Scoring model — Influencing Style Inventory"
          sub={`Ten styles, four statements each, covering statements 1–40 once. Each style scores 0–${maxStyleScore}. Other instruments carry their own model.`}
        />
        <div className="card-body grid-2">
          <div>
            <p className="group-label">Push</p>
            {STYLES.filter((s) => s.side === 'push').map((s) => (
              <div className="kv-line" key={s.key}>
                <b>{s.name}</b>
                <span className="num">items {s.items.join(', ')}</span>
              </div>
            ))}
          </div>
          <div>
            <p className="group-label">Pull</p>
            {STYLES.filter((s) => s.side === 'pull').map((s) => (
              <div className="kv-line" key={s.key}>
                <b>{s.name}</b>
                <span className="num">items {s.items.join(', ')}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
