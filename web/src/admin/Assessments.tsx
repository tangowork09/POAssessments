/**
 * Assessments panel. The table is driven entirely by the assessments table, so
 * a second instrument appears here the moment its rows are inserted — there is
 * nothing to change in this file.
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api.js';
import {
  CardHead,
  copyToClipboard,
  DataTable,
  EmptyState,
  ErrorState,
  Head,
  Loading,
  StatusPill,
  Toast,
  useToast,
} from './ui.js';
import type { Column } from './ui.js';
import { STYLES } from '../../../src/shared/styles.js';
import { MAX_STYLE_SCORE } from '../../../src/shared/scoring.js';
import { isCohortAssessment } from '../../../src/shared/assessments.js';

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

  /** The open link for this instrument, copied without rotating it. */
  async function copyLink(row: Row): Promise<void> {
    setBusy(`link:${row.id}`);
    try {
      const res = await api.get<{ url: string }>(`/api/admin/links/generic/${row.id}`);
      const copied = await copyToClipboard(res.url);
      showToast(copied ? 'Link copied to the clipboard' : res.url);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not fetch the link');
    } finally {
      setBusy(null);
    }
  }

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
          <DataTable
            rows={rows}
            rowKey={(a) => a.id}
            pageSize={25}
            minWidth={980}
            className="table-funnel"
            columns={([
              {
                key: 'name',
                header: 'Assessment',
                className: 'name',
                value: (a) => `${a.name} ${a.description}`,
                cell: (a) => (
                  <>
                    {a.name}
                    <span className="cell-sub">{a.description}</span>
                  </>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                width: '110px',
                value: (a) => a.status,
                cell: (a) => <StatusPill status={a.status} />,
              },
              {
                key: 'questions',
                header: 'Questions',
                width: '100px',
                align: 'right',
                className: 'num',
                value: (a) => a.question_count,
                cell: (a) => a.question_count,
              },
              {
                key: 'invited',
                header: 'Invited',
                width: '90px',
                align: 'right',
                className: 'num',
                value: (a) => a.invited,
                cell: (a) => a.invited,
              },
              {
                key: 'started',
                header: 'Started',
                width: '90px',
                align: 'right',
                className: 'num',
                value: (a) => a.started,
                cell: (a) => a.started,
              },
              {
                key: 'completed',
                header: 'Completed',
                width: '110px',
                align: 'right',
                className: 'num',
                value: (a) => a.completed,
                cell: (a) => a.completed,
              },
              {
                key: 'rate',
                header: 'Completed of started',
                width: '150px',
                align: 'right',
                className: 'num',
                value: (a) => (a.started > 0 ? Math.round((a.completed / a.started) * 100) : -1),
                cell: (a) =>
                  a.started > 0 ? `${Math.round((a.completed / a.started) * 100)}%` : '—',
              },
              {
                key: 'mail',
                header: 'Report email',
                width: '170px',
                value: (a) => (a.auto_send_report === 1 ? 'automatic' : 'manual'),
                cell: (a) => (
                  <>
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
                      <span className="cell-sub">{a.unsent_reports} waiting to be sent</span>
                    ) : null}
                  </>
                ),
              },
              {
                key: 'copy',
                header: '',
                width: '90px',
                className: 'row-actions',
                cell: (a) =>
                  isCohortAssessment(a.id) ? null : (
                    <button
                      className="link-btn"
                      type="button"
                      disabled={busy === `link:${a.id}`}
                      onClick={() => void copyLink(a)}
                    >
                      Copy link
                    </button>
                  ),
              },
            ] as Column<Row>[])}
          />
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
