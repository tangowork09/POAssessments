/**
 * Assessments panel. The table is driven entirely by the assessments table, so
 * a second instrument appears here the moment its rows are inserted — there is
 * nothing to change in this file.
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api.js';
import { CardHead, EmptyState, ErrorState, Head, Loading, StatusPill, Toast, useToast } from './ui.js';
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
  auto_send_report: number;
  /** Reports generated but never emailed — what the manual send acts on. */
  unsent_reports: number;
}

export function Assessments() {
  const [rows, setRows] = useState<Row[] | null>(null);
  // The API owns the scale; the shared constant is only a floor.
  const [maxStyleScore, setMaxStyleScore] = useState(MAX_STYLE_SCORE);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, showToast] = useToast();

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

  async function toggleAutoSend(row: Row): Promise<void> {
    const next = row.auto_send_report !== 1;
    setBusy(row.id);
    // Optimistic: the switch is the control, so it should move under the
    // pointer rather than after a round trip. Reverted below if the call fails.
    setRows((prev) =>
      (prev ?? []).map((r) => (r.id === row.id ? { ...r, auto_send_report: next ? 1 : 0 } : r)),
    );
    try {
      await api.post(`/api/admin/assessments/${row.id}/auto-send`, { autoSend: next });
      showToast(
        next
          ? 'Reports will be emailed automatically on completion'
          : 'Reports will be held — send them from Candidates',
      );
      load();
    } catch (err) {
      setRows((prev) =>
        (prev ?? []).map((r) => (r.id === row.id ? { ...r, auto_send_report: next ? 0 : 1 } : r)),
      );
      showToast(err instanceof ApiError ? err.message : 'Could not change that setting');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Toast message={toast} />
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
                  <th>Report email</th>
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
                    <td>
                      <label className="check-label">
                        <input
                          type="checkbox"
                          checked={a.auto_send_report === 1}
                          disabled={busy === a.id}
                          onChange={() => toggleAutoSend(a)}
                        />
                        <span>{a.auto_send_report === 1 ? 'Automatic' : 'Manual'}</span>
                      </label>
                      {a.auto_send_report === 0 && a.unsent_reports > 0 ? (
                        <span className="cell-sub">
                          {a.unsent_reports} waiting to be sent
                        </span>
                      ) : null}
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
