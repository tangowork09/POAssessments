/** Candidates table: search, filter, per-row actions, CSV and Excel export. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, api } from '../lib/api.js';
import { Head, Loading, StatusPill, Toast, copyToClipboard, formatDate, useToast } from './ui.js';

interface Row {
  response_id: string;
  candidate_id: string;
  status: string;
  answered_count: number;
  invited_at: string;
  started_at: string | null;
  completed_at: string | null;
  first_name: string;
  last_name: string;
  email: string;
  organisation: string;
  assessment_id: string;
  assessment_name: string;
  question_count: number;
  link_id: string | null;
  link_active: number | null;
  push: number | null;
  pull: number | null;
  hasReport: boolean;
}

export function Candidates() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [toast, showToast] = useToast();

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (status) params.set('status', status);
    api
      .get<{ candidates: Row[] }>(`/api/admin/candidates?${params}`)
      .then((r) => setRows(r.candidates))
      .catch(() => setRows([]));
  }, [query, status]);

  useEffect(() => {
    const t = setTimeout(load, query ? 220 : 0);
    return () => clearTimeout(t);
  }, [load, query]);

  const counts = useMemo(() => {
    const all = rows ?? [];
    return {
      total: all.length,
      completed: all.filter((r) => r.status === 'completed').length,
    };
  }, [rows]);

  async function copyLink(row: Row): Promise<void> {
    setBusyRow(row.response_id);
    try {
      const res = await api.post<{ url: string; rotated: boolean }>(
        `/api/admin/candidates/${row.response_id}/link`,
      );
      const copied = await copyToClipboard(res.url);
      showToast(copied ? 'Personal link copied to the clipboard' : res.url);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not create a link');
    } finally {
      setBusyRow(null);
    }
  }

  async function resend(row: Row): Promise<void> {
    setBusyRow(row.response_id);
    try {
      const res = await api.post<{ status: string; error: string | null }>(
        `/api/admin/candidates/${row.response_id}/resend`,
      );
      showToast(
        res.status === 'sent'
          ? `Invitation resent to ${row.email}`
          : res.status === 'logged'
            ? 'No mail provider configured — the message is in the outbox'
            : `Send failed: ${res.error ?? 'unknown error'}`,
      );
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not resend');
    } finally {
      setBusyRow(null);
    }
  }

  async function toggleLink(row: Row): Promise<void> {
    if (!row.link_id) return;
    setBusyRow(row.response_id);
    try {
      const next = !(row.link_active === 1);
      await api.post(`/api/admin/links/${row.link_id}/active`, { active: next });
      showToast(next ? 'Link re-enabled' : 'Link disabled');
      load();
    } finally {
      setBusyRow(null);
    }
  }

  return (
    <>
      <Head
        title="Candidates"
        sub={rows ? `${counts.total} shown · ${counts.completed} completed` : undefined}
        actions={
          <>
            <a className="btn btn-secondary btn-sm" href="/api/admin/export/csv">
              Export CSV
            </a>
            <a className="btn btn-secondary btn-sm" href="/api/admin/export/xlsx">
              Export Excel
            </a>
          </>
        }
      />

      <section className="card">
        <div className="card-head">
          <div className="toolbar-row">
            <div className="search">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="7" cy="7" r="4.5" />
                <path d="M10.5 10.5L14 14" strokeLinecap="round" />
              </svg>
              <input
                className="control"
                placeholder="Search name, email or organisation"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search candidates"
              />
            </div>
            <select
              className="control"
              style={{ width: 180, height: 36 }}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              <option value="invited">Invited</option>
              <option value="in_progress">In progress</option>
              <option value="completed">Completed</option>
            </select>
          </div>
        </div>

        {!rows ? (
          <Loading />
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <b>No candidates match</b>
            Clear the search, or invite someone from the Invites panel.
          </div>
        ) : (
          <div className="table-scroll capped">
            <table>
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>Organisation</th>
                  <th>Assessment</th>
                  <th>Status</th>
                  <th className="right">Push /100</th>
                  <th className="right">Pull /100</th>
                  <th className="right">Completed</th>
                  <th className="right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.response_id}>
                    <td className="name">
                      {r.first_name || '—'} {r.last_name}
                      <span className="cell-sub">{r.email}</span>
                    </td>
                    <td>{r.organisation || '—'}</td>
                    <td>{r.assessment_name}</td>
                    <td>
                      <StatusPill status={r.status} answered={r.answered_count} />
                      {r.link_active === 0 ? (
                        <span className="cell-sub" style={{ color: 'var(--danger)' }}>
                          link disabled
                        </span>
                      ) : null}
                    </td>
                    <td className="right num">{r.push ?? '—'}</td>
                    <td className="right num">{r.pull ?? '—'}</td>
                    <td className="right">{formatDate(r.completed_at)}</td>
                    <td className="right">
                      <div style={{ display: 'inline-flex', gap: 12 }}>
                        <button
                          className="link-btn"
                          onClick={() => copyLink(r)}
                          disabled={busyRow === r.response_id}
                        >
                          Copy link
                        </button>
                        <button
                          className="link-btn"
                          onClick={() => resend(r)}
                          disabled={busyRow === r.response_id}
                        >
                          Resend
                        </button>
                        {r.link_id ? (
                          <button
                            className="link-btn"
                            onClick={() => toggleLink(r)}
                            disabled={busyRow === r.response_id}
                          >
                            {r.link_active === 1 ? 'Disable' : 'Enable'}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="inline-note" style={{ marginTop: 12 }}>
        Copying a personal link issues a fresh one: tokens are stored only as keyed hashes, so the previous
        value cannot be read back and stops working. Reports are opened by the candidate from their own
        emailed link.
      </p>

      <Toast message={toast} />
    </>
  );
}
