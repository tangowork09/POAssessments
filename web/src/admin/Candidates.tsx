/**
 * Candidates grid: filters, bulk selection, per-row actions and exports.
 *
 * Every number on this page comes from the API. Nothing is sampled, seeded or
 * padded — an empty grid is rendered as an empty grid.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../lib/api.js';
import {
  DataTable,
  EmptyState,
  ErrorState,
  Head,
  StatusPill,
  TableSkeleton,
  Toast,
  copyToClipboard,
  formatDate,
  useToast,
} from './ui.js';
import type { Column } from './ui.js';

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
  /** Pre-formatted per instrument — ISI and ego report different things. */
  resultLabel: string | null;
  assessmentKind: 'isi' | 'ego' | null;
  hasReport: boolean;
  /** False when the report exists but its email has never gone out. */
  reportSent: boolean;
}

interface FilterOptions {
  assessments: { id: string; name: string }[];
  organisations: string[];
  statuses: string[];
}

interface Filters {
  q: string;
  status: string;
  assessment: string;
  organisation: string;
  preset: DatePreset;
  from: string;
  to: string;
}

type DatePreset = 'any' | '7' | '30' | '90' | 'custom';

const EMPTY_FILTERS: Filters = {
  q: '',
  status: '',
  assessment: '',
  organisation: '',
  preset: 'any',
  from: '',
  to: '',
};

const STATUS_LABELS: Record<string, string> = {
  invited: 'Invited',
  in_progress: 'In progress',
  completed: 'Completed',
};

/** YYYY-MM-DD in the viewer's own calendar, which is what a date input expects. */
function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function resolveRange(f: Filters): { from: string; to: string } {
  if (f.preset === 'any') return { from: '', to: '' };
  if (f.preset === 'custom') return { from: f.from, to: f.to };
  const days = Number(f.preset);
  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * 86_400_000);
  return { from: isoDay(from), to: isoDay(to) };
}

function activeFilterCount(f: Filters): number {
  const range = resolveRange(f);
  return (
    (f.q.trim() ? 1 : 0) +
    (f.status ? 1 : 0) +
    (f.assessment ? 1 : 0) +
    (f.organisation ? 1 : 0) +
    (range.from || range.to ? 1 : 0)
  );
}

export function Candidates() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Read once, on mount: this is what makes a Dashboard tile ("Completed" etc.)
  // land here pre-filtered. Not kept in sync afterwards — a candidate clearing
  // filters by hand shouldn't fight the URL that got them here.
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState<Filters>(() => {
    const status = searchParams.get('status');
    return status && status in STATUS_LABELS ? { ...EMPTY_FILTERS, status } : EMPTY_FILTERS;
  });
  const [options, setOptions] = useState<FilterOptions | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [toast, showToast] = useToast();

  const set = useCallback(<K extends keyof Filters>(key: K, value: Filters[K]): void => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const range = resolveRange(filters);
  const activeCount = activeFilterCount(filters);

  /** Every filter is in the query string, so the URL fully describes the view. */
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.q.trim()) params.set('q', filters.q.trim());
    if (filters.status) params.set('status', filters.status);
    if (filters.assessment) params.set('assessment', filters.assessment);
    if (filters.organisation) params.set('organisation', filters.organisation);
    if (range.from) params.set('from', range.from);
    if (range.to) params.set('to', range.to);
    return params.toString();
  }, [filters.q, filters.status, filters.assessment, filters.organisation, range.from, range.to]);

  const load = useCallback(() => {
    setError(null);
    api
      .get<{ candidates: Row[] }>(`/api/admin/candidates?${queryString}`)
      .then((r) => setRows(r.candidates))
      .catch((e: unknown) => {
        setRows(null);
        setError(e instanceof ApiError ? e.message : 'The candidate list could not be loaded.');
      });
  }, [queryString]);

  // Debounce only while typing; every other filter applies immediately.
  useEffect(() => {
    const t = setTimeout(load, filters.q ? 220 : 0);
    return () => clearTimeout(t);
  }, [load, filters.q]);

  useEffect(() => {
    api
      .get<FilterOptions>('/api/admin/candidates/filters')
      .then(setOptions)
      .catch(() => setOptions({ assessments: [], organisations: [], statuses: [] }));
  }, []);

  /**
   * Filters changing means the visible set changed; ids selected under the old
   * filters must not be carried into a bulk action.
   */
  useEffect(() => {
    setSelected(new Set());
    setConfirmDisable(false);
  }, [queryString]);

  const all = rows ?? [];
  /**
   * The rows on screen — after the table's own filters and page, not merely
   * after the server's. "Select all" that quietly selected four hundred rows
   * while showing twenty-five would be a bulk action nobody consented to.
   */
  const [shown, setShown] = useState<Row[]>([]);
  const visible = shown.length > 0 || all.length === 0 ? shown : all;
  const selectedRows = useMemo(
    () => visible.filter((r) => selected.has(r.response_id)),
    [visible, selected],
  );
  const selectedIds = selectedRows.map((r) => r.response_id);
  const allSelected = visible.length > 0 && selectedIds.length === visible.length;
  const someSelected = selectedIds.length > 0 && !allSelected;

  const headerBox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headerBox.current) headerBox.current.indeterminate = someSelected;
  }, [someSelected]);

  const counts = useMemo(
    () => ({ total: visible.length, completed: visible.filter((r) => r.status === 'completed').length }),
    [visible],
  );

  function toggleAll(): void {
    setSelected(allSelected ? new Set() : new Set(visible.map((r) => r.response_id)));
    setConfirmDisable(false);
  }

  function toggleRow(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setConfirmDisable(false);
  }

  function clearFilters(): void {
    setFilters(EMPTY_FILTERS);
  }

  // ------------------------------------------------------------- row actions

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

  /** The manual counterpart to auto-send: emails a report already generated. */
  async function sendReport(row: Row): Promise<void> {
    setBusyRow(row.response_id);
    try {
      const res = await api.post<{ status: string; error: string | null; resent: boolean }>(
        `/api/admin/candidates/${row.response_id}/send-report`,
      );
      showToast(
        res.status === 'sent'
          ? `Report ${res.resent ? 'resent' : 'sent'} to ${row.email}`
          : res.status === 'logged'
            ? 'No mail provider configured — the message is in the outbox'
            : `Send failed: ${res.error ?? 'unknown error'}`,
      );
      load();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not send the report');
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
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not change that link');
    } finally {
      setBusyRow(null);
    }
  }

  // ------------------------------------------------------------ bulk actions

  async function bulkResend(): Promise<void> {
    if (selectedIds.length === 0) return;
    setBulkBusy(true);
    try {
      const res = await api.post<{ sent: number; failed: number }>('/api/admin/candidates/bulk/resend', {
        responseIds: selectedIds,
      });
      const total = res.sent + res.failed;
      showToast(
        res.failed === 0
          ? `${res.sent} ${res.sent === 1 ? 'invitation' : 'invitations'} resent`
          : `${res.sent} of ${total} invitations resent — ${res.failed} failed`,
      );
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not resend those invitations');
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkDisable(): Promise<void> {
    if (selectedIds.length === 0) return;
    setBulkBusy(true);
    try {
      const res = await api.post<{ changed: number }>('/api/admin/candidates/bulk/links', {
        responseIds: selectedIds,
        active: false,
      });
      showToast(
        res.changed === 0
          ? 'No active links to disable in that selection'
          : `${res.changed} ${res.changed === 1 ? 'link' : 'links'} disabled`,
      );
      setConfirmDisable(false);
      setSelected(new Set());
      load();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not disable those links');
    } finally {
      setBulkBusy(false);
    }
  }

  /**
   * A hidden form POST would work, but it navigates the top-level document:
   * a 401 or 500 would replace the console with a raw error page and lose the
   * selection. fetch → blob keeps the failure inside the app, where it becomes
   * a toast, and lets us honour the server's filename.
   */
  async function exportSelected(): Promise<void> {
    if (selectedIds.length === 0) return;
    setBulkBusy(true);
    let objectUrl: string | null = null;
    try {
      const res = await fetch('/api/admin/export/csv/selected', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ responseIds: selectedIds }),
      });
      if (!res.ok) {
        showToast(`Export failed (${res.status})`);
        return;
      }
      const disposition = res.headers.get('content-disposition') ?? '';
      const named = /filename="?([^";]+)"?/i.exec(disposition);
      const blob = await res.blob();
      objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = named?.[1] ?? `candidates-${isoDay(new Date())}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      showToast(`${selectedIds.length} ${selectedIds.length === 1 ? 'row' : 'rows'} exported`);
    } catch {
      showToast('Could not export that selection');
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setBulkBusy(false);
    }
  }

  // ------------------------------------------------------------------ render

  const statusOptions = options?.statuses?.length
    ? options.statuses
    : ['invited', 'in_progress', 'completed'];

  return (
    <>
      <Head
        title="Candidates"
        sub={
          rows
            ? `${counts.total} shown · ${counts.completed} completed`
            : 'Everyone invited to an assessment, and where they got to.'
        }
        actions={
          <>
            <a className="btn btn-secondary btn-sm" href="/api/admin/export/csv">
              Export all (CSV)
            </a>
            <a className="btn btn-secondary btn-sm" href="/api/admin/export/xlsx">
              Export all (Excel)
            </a>
          </>
        }
      />

      <section className="card">
        <div className="filter-bar">
          <div className="search">
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <circle cx="7" cy="7" r="4.5" />
              <path d="M10.5 10.5L14 14" strokeLinecap="round" />
            </svg>
            <input
              id="cand-q"
              className="control"
              placeholder="Search name, email or organisation"
              value={filters.q}
              onChange={(e) => set('q', e.target.value)}
              aria-label="Search candidates"
            />
          </div>

          <select
            className="control filter-select"
            value={filters.assessment}
            onChange={(e) => set('assessment', e.target.value)}
            aria-label="Filter by assessment"
          >
            <option value="">All assessments</option>
            {options?.assessments.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>

          <select
            className="control filter-select"
            value={filters.organisation}
            onChange={(e) => set('organisation', e.target.value)}
            aria-label="Filter by organisation"
          >
            <option value="">All organisations</option>
            {options?.organisations.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>

          <select
            className="control filter-select filter-select-sm"
            value={filters.status}
            onChange={(e) => set('status', e.target.value)}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            {statusOptions.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s] ?? s}
              </option>
            ))}
          </select>

          <select
            className="control filter-select filter-select-sm"
            value={filters.preset}
            onChange={(e) => set('preset', e.target.value as DatePreset)}
            aria-label="Filter by date"
          >
            <option value="any">Any time</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="custom">Custom range</option>
          </select>

          {filters.preset === 'custom' ? (
            <div className="date-range">
              <label className="date-field">
                <span>From</span>
                <input
                  type="date"
                  className="control"
                  value={filters.from}
                  max={filters.to || undefined}
                  onChange={(e) => set('from', e.target.value)}
                />
              </label>
              <label className="date-field">
                <span>To</span>
                <input
                  type="date"
                  className="control"
                  value={filters.to}
                  min={filters.from || undefined}
                  onChange={(e) => set('to', e.target.value)}
                />
              </label>
            </div>
          ) : null}

          {activeCount > 0 ? (
            <button className="btn btn-ghost btn-sm filter-clear" type="button" onClick={clearFilters}>
              Clear {activeCount} {activeCount === 1 ? 'filter' : 'filters'}
            </button>
          ) : null}
        </div>

        {selectedIds.length > 0 ? (
          <div className="selection-bar" role="status" aria-live="polite">
            {confirmDisable ? (
              <>
                <span className="selection-count">
                  Disable the personal links for {selectedIds.length}{' '}
                  {selectedIds.length === 1 ? 'candidate' : 'candidates'}? They will not be able to open or
                  resume their assessment.
                </span>
                <div className="selection-actions">
                  <button
                    className="btn btn-ghost btn-sm"
                    type="button"
                    onClick={() => setConfirmDisable(false)}
                    disabled={bulkBusy}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn btn-danger btn-sm"
                    type="button"
                    onClick={bulkDisable}
                    disabled={bulkBusy}
                  >
                    {bulkBusy ? 'Disabling…' : 'Disable links'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <span className="selection-count">
                  <b className="num">{selectedIds.length}</b> selected
                </span>
                <div className="selection-actions">
                  <button
                    className="btn btn-secondary btn-sm"
                    type="button"
                    onClick={bulkResend}
                    disabled={bulkBusy}
                  >
                    Resend invite
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    type="button"
                    onClick={() => setConfirmDisable(true)}
                    disabled={bulkBusy}
                  >
                    Disable links
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    type="button"
                    onClick={exportSelected}
                    disabled={bulkBusy}
                  >
                    Export selected (CSV)
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    type="button"
                    onClick={() => setSelected(new Set())}
                    disabled={bulkBusy}
                  >
                    Clear selection
                  </button>
                </div>
              </>
            )}
          </div>
        ) : null}

        {error ? (
          <ErrorState message={error} onRetry={load} />
        ) : !rows ? (
          <TableSkeleton rows={6} cols={6} />
        ) : rows.length === 0 ? (
          activeCount > 0 ? (
            <EmptyState
              title="No candidates match these filters"
              body="Nothing on the platform fits that combination. Widen the date range, or clear the filters to see everyone."
              action={{ label: 'Clear filters', onClick: clearFilters }}
            />
          ) : (
            <EmptyState
              title="No candidates yet"
              body="Invite someone and they will appear here with their progress, result and personal link."
              action={{ label: 'Send your first invite', to: '/admin/invites' }}
            />
          )
        ) : (
          <DataTable
            rows={all}
            rowKey={(r) => r.response_id}
            pageSize={25}
            minWidth={1080}
            className="table-candidates"
            onShown={setShown}
            toolbar={
              <label className="dt-selectall">
                <input
                  ref={headerBox}
                  type="checkbox"
                  className="row-check"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label={allSelected ? 'Clear selection' : `Select the ${visible.length} rows shown`}
                />
                Select the {visible.length} rows shown
              </label>
            }
            columns={([
              {
                key: 'check',
                header: '',
                width: '34px',
                className: 'col-check',
                cell: (r) => (
                  <input
                    type="checkbox"
                    className="row-check"
                    checked={selected.has(r.response_id)}
                    onChange={() => toggleRow(r.response_id)}
                    aria-label={`Select ${`${r.first_name} ${r.last_name}`.trim() || r.email}`}
                  />
                ),
              },
              {
                key: 'candidate',
                header: 'Candidate',
                filterHint: 'Name or email',
                className: 'name',
                value: (r) => `${r.first_name} ${r.last_name} ${r.email}`,
                cell: (r) => (
                  <>
                    {`${r.first_name} ${r.last_name}`.trim() || r.email}
                    <span className="cell-sub">{r.email}</span>
                  </>
                ),
              },
              {
                key: 'org',
                header: 'Organisation',
                width: '150px',
                className: 'cell-truncate',
                value: (r) => r.organisation ?? '',
                cell: (r) => r.organisation || <span className="muted">—</span>,
              },
              {
                key: 'assessment',
                header: 'Assessment',
                width: '170px',
                className: 'cell-truncate',
                value: (r) => r.assessment_name,
                cell: (r) => r.assessment_name,
              },
              {
                key: 'status',
                header: 'Status',
                width: '140px',
                value: (r) => r.status,
                cell: (r) => (
                  <>
                    <StatusPill status={r.status} />
                    {r.status === 'in_progress' && r.question_count ? (
                      <span className="cell-sub num">
                        {r.answered_count} of {r.question_count}
                      </span>
                    ) : null}
                    {r.link_active === 0 ? (
                      <span className="cell-sub danger">Link disabled</span>
                    ) : null}
                  </>
                ),
              },
              {
                key: 'result',
                header: 'Result',
                width: '150px',
                className: 'cell-result',
                value: (r) => r.resultLabel ?? '',
                cell: (r) =>
                  r.resultLabel ? (
                    <>
                      <span className="result-label num">{r.resultLabel}</span>
                      {!r.reportSent ? <span className="cell-sub">Report not emailed</span> : null}
                    </>
                  ) : (
                    <span className="muted">
                      {r.status === 'completed' ? 'Report pending' : 'Not yet'}
                    </span>
                  ),
              },
              {
                key: 'completed',
                header: 'Completed',
                width: '120px',
                align: 'right',
                className: 'num',
                value: (r) => r.completed_at ?? '',
                cell: (r) => formatDate(r.completed_at),
              },
              {
                key: 'actions',
                header: 'Actions',
                width: '250px',
                align: 'right',
                cell: (r) => {
                  const name = `${r.first_name} ${r.last_name}`.trim() || r.email;
                  return (
                    <div className="row-actions">
                      <button
                        className="link-btn"
                        type="button"
                        onClick={() => copyLink(r)}
                        disabled={busyRow === r.response_id}
                        aria-label={`Copy the personal link for ${name}`}
                      >
                        Copy link
                      </button>
                      <button
                        className="link-btn"
                        type="button"
                        onClick={() => resend(r)}
                        disabled={busyRow === r.response_id}
                        aria-label={`Resend the invitation to ${name}`}
                      >
                        Resend
                      </button>
                      {r.hasReport ? (
                        <button
                          className="link-btn"
                          type="button"
                          onClick={() => sendReport(r)}
                          disabled={busyRow === r.response_id}
                          aria-label={
                            r.reportSent
                              ? `Send the report to ${name} again`
                              : `Send the report to ${name}`
                          }
                        >
                          {r.reportSent ? 'Resend report' : 'Send report'}
                        </button>
                      ) : null}
                      {r.link_id ? (
                        <button
                          className="link-btn"
                          type="button"
                          onClick={() => toggleLink(r)}
                          disabled={busyRow === r.response_id}
                          aria-label={`${r.link_active === 1 ? 'Disable' : 'Enable'} the link for ${name}`}
                        >
                          {r.link_active === 1 ? 'Disable' : 'Enable'}
                        </button>
                      ) : null}
                    </div>
                  );
                },
              },
            ] as Column<Row>[])}
          />
        )}
      </section>

      <p className="inline-note mt-3">
        Copying a personal link issues a fresh one: tokens are stored only as keyed hashes, so the previous
        value cannot be read back and stops working. Reports are opened by the candidate from their own
        emailed link.
      </p>

      <Toast message={toast} />
    </>
  );
}
