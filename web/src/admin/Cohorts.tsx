/**
 * Cohorts: the console for running Collaboration Sociometry.
 *
 * A cohort is one run of the instrument on one intact group. The facilitator
 * builds a roster, opens the run, watches responses arrive, then generates the
 * group report and each leader's own.
 *
 * The rule that shapes this screen is that roster positions are the addresses
 * stored ratings point at. Editing a roster mid-run therefore does not renumber
 * anyone: a matched name keeps its position, a removed one leaves its position
 * permanently spoken for, and the panel says so where it matters.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../lib/api.js';
import { DataTable, Head, TableSkeleton, Toast, useToast } from './ui.js';
import { CohortNetworkCard } from './network/CohortNetworkCard.js';
import type { CohortDetail, CohortSummary, CohortTrend } from '../../../src/shared/types.js';

interface CohortReportRow {
  roundNo: number;
  roundName: string;
  id: string;
  scope: 'group' | 'member';
  memberId: string | null;
  memberName: string | null;
  memberEmail: string | null;
  suppressed: boolean;
  createdAt: string;
  sentAt: string | null;
  url: string | null;
}

export function Cohorts() {
  // null until the first load answers: an empty array would flash "no cohorts
  // yet" at someone who has forty.
  const [cohorts, setCohorts] = useState<CohortSummary[] | null>(null);
  // The open cohort lives in the URL (?c=...), so a reload — or a shared link —
  // lands back on the same cohort instead of the list.
  const [params, setParams] = useSearchParams();
  const selected = params.get('c');
  const setSelected = useCallback(
    (id: string | null) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) next.set('c', id);
          else {
            next.delete('c');
            next.delete('tab');
          }
          return next;
        },
        { replace: false },
      );
    },
    [setParams],
  );
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newOrg, setNewOrg] = useState('');
  const [toast, showToast] = useToast();
  const importRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ cohorts: CohortSummary[] }>('/api/admin/cohorts');
      setCohorts(res.cohorts);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load cohorts.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await api.post<{ id: string }>('/api/admin/cohorts', {
        name: newName.trim(),
        organisation: newOrg.trim(),
      });
      setNewName('');
      setNewOrg('');
      await load();
      setSelected(res.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create that cohort.');
    } finally {
      setCreating(false);
    }
  }

  /**
   * The one-motion path: workbook in, cohort out. Name and organisation typed
   * into the form win; otherwise label rows in the sheet, then the filename.
   * On success the console opens the new cohort, roster already in place.
   */
  async function importWorkbook(file: File): Promise<void> {
    setCreating(true);
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(buf);
      // Chunked: a spread over a large array blows the argument limit.
      for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      }
      const res = await api.post<{ id: string; name: string; size: number; skipped: string[] }>(
        '/api/admin/cohorts/import',
        {
          fileBase64: btoa(binary),
          filename: file.name,
          name: newName.trim(),
          organisation: newOrg.trim(),
        },
      );
      showToast(
        `"${res.name}" created with ${res.size} people${
          res.skipped.length > 0 ? ` — ${res.skipped.length} row${res.skipped.length === 1 ? '' : 's'} skipped` : ''
        }.`,
      );
      setNewName('');
      setNewOrg('');
      await load();
      setSelected(res.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not read that file.');
    } finally {
      setCreating(false);
    }
  }

  if (selected) {
    return (
      <CohortPanel
        cohortId={selected}
        onClose={() => {
          setSelected(null);
          void load();
        }}
      />
    );
  }

  return (
    <>
      <Head title="Cohorts" />
      <Toast message={toast} />

      <section className="card">
        <div className="card-body">
          <h2>New cohort</h2>

          <div className="cohort-create">
            {/* The fast path: the client's spreadsheet, one motion. */}
            <button
              type="button"
              className="upload-zone"
              disabled={creating}
              onClick={() => importRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f) void importWorkbook(f);
              }}
            >
              <span className="upload-zone-icon" aria-hidden="true">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 16V4" />
                  <path d="M7 9l5-5 5 5" />
                  <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
                </svg>
              </span>
              <span className="upload-zone-title">
                {creating ? 'Reading…' : 'Upload an Excel roster'}
              </span>
              <span className="upload-zone-sub">
                Creates the cohort in one go — people from the rows, cohort and organisation from label
                rows in the sheet or the filename. Drop a .xlsx here or click to choose.
              </span>
            </button>
            <input
              ref={importRef}
              type="file"
              accept=".xlsx"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importWorkbook(f);
                e.target.value = '';
              }}
            />

            <div className="cohort-create-or" aria-hidden="true">or</div>

            {/* The typed path. With a name given, the upload above uses it too,
                so the two halves compose rather than compete. */}
            <form className="cohort-create-form" onSubmit={create}>
              <input
                className="control"
                placeholder="Cohort name, e.g. Acme Pharma leadership, Sept 2026"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <input
                className="control"
                placeholder="Organisation"
                value={newOrg}
                onChange={(e) => setNewOrg(e.target.value)}
              />
              <button className="btn btn-primary" disabled={creating || !newName.trim()}>
                {creating ? 'Creating…' : 'New cohort'}
              </button>
              <p className="hint" style={{ margin: 0 }}>
                Starts empty — add people inside the cohort, by hand, paste or the same Excel upload.
              </p>
            </form>
          </div>

          {error ? <p className="hint" role="alert" style={{ color: 'var(--danger)' }}>{error}</p> : null}
        </div>
      </section>

      <section className="card">
        <div className="card-body">
          <h2>All cohorts</h2>
          {cohorts === null ? <TableSkeleton rows={5} cols={6} /> : null}
          <DataTable
            expand={(c) => <CohortLinks cohortId={c.id} />}
            expandLabel={(c) => `Show every link issued for ${c.name}`}
            rows={cohorts ?? []}
            rowKey={(c) => c.id}
            minWidth={860}
            empty={
              cohorts === null ? (
                <></>
              ) : (
                <p className="hint">No cohorts yet. Create one above to get started.</p>
              )
            }
            columns={[
              {
                key: 'name',
                header: 'Cohort',
                filterHint: 'Name or organisation',
                value: (c) => `${c.name} ${c.organisation}`,
                cell: (c) => (
                  <>
                    <b>{c.name}</b>
                    {c.organisation ? <div className="cell-sub">{c.organisation}</div> : null}
                  </>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                width: '110px',
                value: (c) => c.status,
                cell: (c) => <span className={`pill ${statusPill(c.status)}`}>{c.status}</span>,
              },
              {
                key: 'round',
                header: 'Round',
                width: '130px',
                value: (c) => c.roundName,
                cell: (c) => (
                  <>
                    {c.roundName}
                    {c.roundCount > 1 ? (
                      <div className="cell-sub">{`${c.roundCount} waves`}</div>
                    ) : null}
                  </>
                ),
              },
              {
                key: 'roster',
                header: 'Roster',
                width: '90px',
                align: 'right',
                value: (c) => c.rosterSize,
                cell: (c) => c.rosterSize,
              },
              {
                key: 'responded',
                header: 'Responded',
                width: '110px',
                align: 'right',
                value: (c) => c.respondents,
                cell: (c) => (
                  <>
                    {c.respondents}
                    {c.rosterSize > 0 ? (
                      <span className="cell-sub">{` · ${Math.round((c.respondents / c.rosterSize) * 100)}%`}</span>
                    ) : null}
                  </>
                ),
              },
              {
                key: 'reports',
                header: 'Reports',
                value: (c) =>
                  c.reports.group ? `group ${c.reports.members} members` : 'not generated',
                cell: (c) =>
                  c.reports.group
                    ? `Group + ${c.reports.members} member${c.reports.members === 1 ? '' : 's'}${
                        c.reports.suppressed > 0 ? ` (${c.reports.suppressed} withheld)` : ''
                      }`
                    : 'Not generated',
              },
              {
                key: 'open',
                header: '',
                width: '92px',
                cell: (c) => (
                  <button className="btn btn-secondary btn-sm" onClick={() => setSelected(c.id)}>
                    Open
                  </button>
                ),
              },
            ]}
          />
        </div>
      </section>
    </>
  );
}

// ------------------------------------------------------------------- panel

function CohortPanel({ cohortId, onClose }: { cohortId: string; onClose: () => void }) {
  const [cohort, setCohort] = useState<CohortDetail | null>(null);
  const [reports, setReports] = useState<CohortReportRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Confirmations are a toast, not a banner. A banner pushed the whole page
  // down to say something that needs no action and is true for two seconds,
  // and it sat in the red error slot, which made "Short link set" look like a
  // failure. Errors keep the banner: those want the room and the colour.
  const [toast, showToast] = useToast();
  const [busy, setBusy] = useState(false);
  const [rosterText, setRosterText] = useState('');
  const [link, setLink] = useState<string | null>(null);
  // The tab lives in the URL too (?tab=info), so a reload keeps the view.
  const [params, setParams] = useSearchParams();
  const activeTab: 'overview' | 'info' = params.get('tab') === 'info' ? 'info' : 'overview';
  const setActiveTab = useCallback(
    (tab: 'overview' | 'info') => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (tab === 'info') next.set('tab', 'info');
          else next.delete('tab');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const load = useCallback(async () => {
    try {
      const [detail, rep] = await Promise.all([
        api.get<CohortDetail>(`/api/admin/cohorts/${cohortId}`),
        api.get<{ reports: CohortReportRow[] }>(`/api/admin/cohorts/${cohortId}/reports`),
      ]);
      setCohort(detail);
      setReports(rep.reports);
      setLink(detail.linkToken ? `${window.location.origin}/t/${detail.linkToken}` : null);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this cohort.');
    }
  }, [cohortId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (cohort) document.title = `${cohort.name} — Admin console`;
  }, [cohort]);

  async function run<T>(fn: () => Promise<T>, success?: string): Promise<T | null> {
    setBusy(true);
    setError(null);
    try {
      const out = await fn();
      if (success) showToast(success);
      await load();
      return out;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work. Please try again.');
      return null;
    } finally {
      setBusy(false);
    }
  }

  if (!cohort) {
    return (
      <>
        <Head title="Cohort" />
        {error ? <div className="banner is-shown">{error}</div> : <TableSkeleton rows={6} cols={5} />}
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          Back to cohorts
        </button>
      </>
    );
  }

  const responded = cohort.roster.filter((m) => m.responded).length;

  return (
    <div className="cohort-detail">
      {/* Back sits with the title, not in a separate row: one glance gives you
          where you are and the way out of it. */}
      <div className="cohort-topbar">
        <button className="cohort-back" onClick={onClose} aria-label="Back to all cohorts" title="All cohorts">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <h1 className="cohort-title">{cohort.name}</h1>
        {cohort.organisation ? <span className="cohort-org">{cohort.organisation}</span> : null}
        <span className={`pill ${statusPill(cohort.status)}`} style={{ marginLeft: 'auto' }}>
          {cohort.status}
        </span>
      </div>

      <div className="cohort-tabs" role="tablist" aria-label="Cohort views">
        {(
          [
            ['overview', 'Overview'],
            ['info', 'Info'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={activeTab === k}
            className={`cohort-tab${activeTab === k ? ' is-on' : ''}`}
            onClick={() => setActiveTab(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? <div className="banner is-shown">{error}</div> : null}

      {activeTab === 'overview' ? (
        <CohortNetworkCard cohortId={cohortId} roundCount={cohort.roundCount} fullBleed />
      ) : null}

      <div style={{ display: activeTab === 'info' ? 'contents' : 'none' }}>

      <section className="card">
        <div className="card-body">
          <h2>{cohort.name}</h2>
          {cohort.organisation ? <p className="hint">{cohort.organisation}</p> : null}

          <div className="co-stats">
            <Stat label="Roster" value={String(cohort.rosterSize)} note="active members" />
            <Stat
              label="Responded"
              value={`${responded} of ${cohort.rosterSize}`}
              note={cohort.rosterSize > 0 ? `${Math.round((responded / cohort.rosterSize) * 100)}%` : '—'}
            />
            <Stat label="Rater floor" value={String(cohort.minRaters)} note="for an individual report" />
            <Stat label="Tie threshold" value={String(cohort.tieThreshold)} note="rating counted as a tie" />
          </div>

          <div className="btn-row">
            {cohort.status !== 'open' ? (
              <button
                className="btn btn-primary btn-sm"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => api.patchJson(`/api/admin/cohorts/${cohortId}`, { status: 'open' }),
                    'Cohort opened. Share the link below with the group.',
                  )
                }
              >
                Open the exercise
              </button>
            ) : (
              <button
                className="btn btn-secondary btn-sm"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => api.patchJson(`/api/admin/cohorts/${cohortId}`, { status: 'closed' }),
                    'Cohort closed. No further responses will be accepted.',
                  )
                }
              >
                Close the exercise
              </button>
            )}

            <button
              className="btn btn-secondary btn-sm"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const res = await api.post<{ url: string }>(`/api/admin/cohorts/${cohortId}/link`);
                  setLink(res.url);
                }, 'Link issued. Any copy of the previous link has stopped working.')
              }
            >
              {link ? 'Re-issue the link' : 'Issue the link'}
            </button>
          </div>

          {link ? (
            <>
              <div className="linkbox">
                <code>{link}</code>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => void navigator.clipboard?.writeText(link)}
                >
                  Copy
                </button>
              </div>
              <ShortLink cohort={cohort} busy={busy} onRun={run} />
            </>
          ) : (
            <p className="hint">
              No link yet. Issue one once the roster is right — everyone in the group uses the same link
              and identifies themselves from the roster when they open it.
            </p>
          )}

          {/* Two-way binding. Off, the enrolled email alone opens the exercise;
              on, a mailed six-digit code must come back first, so a colleague
              who merely knows an address cannot answer as its owner. */}
          <div className="share-toggle">
            <div>
              <b>Require sign-in code (OTP)</b>
              <p className="hint" style={{ margin: '2px 0 0' }}>
                {cohort.otpRequired
                  ? 'On — respondents type their enrolled email, receive a 6-digit code there, and must enter it before the exercise opens. Proof of inbox, not just knowledge of an address.'
                  : 'Off — the enrolled email alone opens the exercise. Fine for a trusted group; switch on for two-way binding in a large organisation.'}
              </p>
            </div>
            <button
              className={`btn btn-sm ${cohort.otpRequired ? 'btn-secondary' : 'btn-primary'}`}
              disabled={busy}
              onClick={() =>
                void run(
                  () => api.patchJson(`/api/admin/cohorts/${cohortId}`, { otpRequired: !cohort.otpRequired }),
                  cohort.otpRequired
                    ? 'Sign-in codes switched off — the enrolled email alone opens the exercise.'
                    : 'Sign-in codes switched on — every respondent must confirm a mailed 6-digit code.',
                )
              }
            >
              {cohort.otpRequired ? 'Switch off' : 'Switch on'}
            </button>
          </div>
        </div>
      </section>

      <MemberLinksPanel cohort={cohort} busy={busy} onRun={run} />

      <RoundsPanel cohort={cohort} busy={busy} onRun={run} />

      {cohort.roundCount > 1 ? <TrendPanel cohortId={cohortId} /> : null}

      <RosterPanel
        cohort={cohort}
        busy={busy}
        onRun={run}
        rosterText={rosterText}
        setRosterText={setRosterText}
      />

      <AssignmentsPanel cohort={cohort} busy={busy} onRun={run} />

      <section className="card">
        <div className="card-body">
          <h2>Reports</h2>
          <p className="hint">
            Generating scores the whole cohort at once and produces the group report plus one report per
            member. Re-generating updates the numbers and keeps the group link working. A member rated by
            fewer than {cohort.minRaters} colleagues is withheld rather than reported — an average of one
            or two responses in a named group identifies who gave them.
          </p>

          {/* The completion screen's promise is controlled from here. Off — the
              default — respondents are thanked and told nothing about reports;
              their profiles still exist for the facilitator to hand over however
              the engagement calls for. On, the completion screen says a summary
              is coming by email, so only turn it on when that is actually the
              plan. */}
          <div className="share-toggle">
            <div>
              <b>Share reports with participants</b>
              <p className="hint" style={{ margin: '2px 0 0' }}>
                {cohort.shareReports
                  ? 'On — the completion screen tells each respondent a personal summary will be emailed to them. Turning it off stops that promise for anyone who finishes afterwards.'
                  : 'Off — respondents see a plain thank-you when they finish. No report, PDF or email is mentioned to them.'}
              </p>
            </div>
            <button
              className={`btn btn-sm ${cohort.shareReports ? 'btn-secondary' : 'btn-primary'}`}
              disabled={busy}
              onClick={() =>
                void run(
                  () =>
                    api.patchJson(`/api/admin/cohorts/${cohortId}`, {
                      shareReports: !cohort.shareReports,
                    }),
                  cohort.shareReports
                    ? 'Report sharing switched off — participants are no longer promised a report.'
                    : 'Report sharing switched on — participants are told their summary will be emailed.',
                )
              }
            >
              {cohort.shareReports ? 'Switch off' : 'Switch on'}
            </button>
          </div>

          {/* The same floor applies to the group report, so the button says so
              before it is pressed rather than after: a cohort nobody has
              answered would otherwise produce a "ready" report of an empty
              network, and one or two responses would produce a group report
              that is one person's opinions with the name taken off. */}
          {responded < cohort.minRaters ? (
            <p className="hint">
              <b>
                {responded === 0
                  ? 'Nobody has responded yet.'
                  : `${responded} of ${cohort.rosterSize} ${responded === 1 ? 'has' : 'have'} responded.`}
              </b>{' '}
              Reports need at least {cohort.minRaters} responses, for the group as well as for each
              member — share the link and come back.
            </p>
          ) : null}

          <div className="btn-row">
            <button
              className="btn btn-primary btn-sm"
              disabled={busy || responded < cohort.minRaters}
              onClick={() =>
                void run(async () => {
                  const res = await api.post<{ members: number; suppressed: number }>(
                    `/api/admin/cohorts/${cohortId}/reports`,
                  );
                  showToast(
                    `Generated the group report and ${res.members} member report${
                      res.members === 1 ? '' : 's'
                    }${res.suppressed > 0 ? `, of which ${res.suppressed} were withheld for low coverage` : ''}.`,
                  );
                })
              }
            >
              {reports.length > 0 ? 'Re-generate reports' : 'Generate reports'}
            </button>
          </div>

          {reports.length === 0 ? null : (
            <div style={{ marginTop: 16 }}>
              <DataTable
                rows={reports}
                rowKey={(r) => r.id}
                pageSize={10}
                minWidth={820}
                columns={[
                  {
                    key: 'report',
                    header: 'Report',
                    value: (r) => (r.scope === 'group' ? 'Group report' : (r.memberName ?? '')),
                    cell: (r) => (
                      <>
                        <b>{r.scope === 'group' ? 'Group report' : r.memberName}</b>
                        {r.scope === 'member' && !r.memberEmail ? (
                          <div className="cell-sub">no email on the roster</div>
                        ) : null}
                      </>
                    ),
                  },
                  {
                    key: 'round',
                    header: 'Round',
                    width: '140px',
                    value: (r) => r.roundName,
                    cell: (r) => r.roundName,
                  },
                  {
                    key: 'status',
                    header: 'Status',
                    width: '110px',
                    value: (r) => (r.suppressed ? 'withheld' : 'ready'),
                    cell: (r) =>
                      r.suppressed ? (
                        <span className="pill pill-plain">withheld</span>
                      ) : (
                        <span className="pill pill-ok">ready</span>
                      ),
                  },
                  {
                    key: 'sent',
                    header: 'Sent',
                    width: '120px',
                    value: (r) => r.sentAt ?? '',
                    cell: (r) => (r.sentAt ? formatDate(r.sentAt) : '—'),
                  },
                  {
                    key: 'actions',
                    header: '',
                    width: '250px',
                    className: 'row-actions',
                    cell: (r) => (
                      <>
                        <a
                          className="btn btn-ghost btn-sm"
                          href={`/api/admin/cohorts/${cohortId}/reports/${r.id}/pdf`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          PDF
                        </a>
                        {r.scope === 'group' && r.url ? (
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => void navigator.clipboard?.writeText(r.url!)}
                          >
                            Copy link
                          </button>
                        ) : null}
                        {r.scope === 'member' && !r.suppressed ? (
                          <>
                            <button
                              className="btn btn-ghost btn-sm"
                              disabled={busy || !r.memberEmail}
                              onClick={() =>
                                void run(
                                  () =>
                                    api.post(
                                      `/api/admin/cohorts/${cohortId}/reports/${r.id}/send`,
                                    ),
                                  `Sent to ${r.memberEmail}.`,
                                )
                              }
                            >
                              {r.sentAt ? 'Send again' : 'Send'}
                            </button>
                            <button
                              className="btn btn-ghost btn-sm"
                              disabled={busy}
                              onClick={() =>
                                void run(async () => {
                                  const res = await api.post<{ url: string }>(
                                    `/api/admin/cohorts/${cohortId}/reports/${r.id}/reissue`,
                                  );
                                  await navigator.clipboard?.writeText(res.url);
                                  showToast(
                                    `A fresh link for ${r.memberName} is on your clipboard. The previous one no longer works.`,
                                  );
                                })
                              }
                            >
                              Copy link
                            </button>
                          </>
                        ) : null}
                      </>
                    ),
                  },
                ]}
              />
            </div>
          )}
        </div>
      </section>

      </div>

      <Toast message={toast} />
    </div>
  );
}

/** Status colours follow the platform's pill vocabulary rather than inventing
 *  a per-status class: draft is inert, open is live, closed is finished. */
function statusPill(status: 'draft' | 'open' | 'closed'): string {
  return status === 'open' ? 'pill-ok' : status === 'closed' ? 'pill-neutral' : 'pill-plain';
}

/**
 * A memorable alias for the open link.
 *
 * The token link is 60 characters and fine in an email, but nobody reads it
 * aloud or types it off a slide. The alias is a bare path — `/acme-leadership`
 * — and belongs to the cohort rather than to the instrument, because a cohort
 * instrument has one open link per group and an instrument-level alias would
 * land whoever used it in an arbitrary one.
 *
 * Only resolves while the cohort is open, which is why the hint says so: a
 * closed cohort's alias 404s rather than opening an exercise that refuses them.
 */
function ShortLink({
  cohort,
  busy,
  onRun,
}: {
  cohort: CohortDetail;
  busy: boolean;
  onRun: <T>(fn: () => Promise<T>, success?: string) => Promise<T | null>;
}) {
  const [slug, setSlug] = useState(cohort.shortSlug ?? '');
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  // The alias is namespaced by the instrument, so the prefix is not editable
  // here: `/sociometry/acme-leadership-2026`.
  const prefix = `${origin}/${cohort.instrumentSlug ?? 'sociometry'}/`;
  const full = cohort.shortSlug ? `${prefix}${cohort.shortSlug}` : '';

  return (
    <div className="slugbox">
      <label className="slug-label" htmlFor="cohort-slug">
        Short link
      </label>
      <span className="slug-origin">{prefix}</span>
      <input
        id="cohort-slug"
        className="control control-sm"
        placeholder="acme-leadership-2026"
        value={slug}
        onChange={(e) => setSlug(e.target.value)}
      />
      <button
        className="btn btn-secondary btn-sm"
        disabled={busy || slug === (cohort.shortSlug ?? '')}
        onClick={() =>
          void onRun(
            () => api.patchJson(`/api/admin/cohorts/${cohort.id}`, { shortSlug: slug.trim() }),
            slug.trim()
              ? `Short link set to /${cohort.instrumentSlug ?? 'sociometry'}/${slug.trim()}`
              : 'Short link removed.',
          )
        }
      >
        Save
      </button>
      {cohort.shortSlug ? (
        <>
          {/* Off, not gone. Clearing the slug frees the name for another
              cohort to take; switching it off keeps it reserved and keeps the
              token link — already in people's inboxes — working. */}
          <button
            className={`btn btn-sm ${cohort.slugActive ? 'btn-ghost' : 'btn-secondary'}`}
            disabled={busy}
            onClick={() =>
              void onRun(
                () =>
                  api.patchJson(`/api/admin/cohorts/${cohort.id}`, {
                    slugActive: !cohort.slugActive,
                  }),
                cohort.slugActive ? 'Short link switched off.' : 'Short link switched on.',
              )
            }
          >
            {cohort.slugActive ? 'Switch off' : 'Switch on'}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            disabled={!cohort.slugActive}
            onClick={() => void navigator.clipboard?.writeText(full)}
          >
            Copy
          </button>
          <span className={`slug-state is-${cohort.slugActive ? 'on' : 'off'}`}>
            {cohort.slugActive ? 'Active' : 'Off'}
          </span>
        </>
      ) : null}
      <p className="hint slug-hint">
        {cohort.shortSlug && !cohort.slugActive
          ? 'Switched off: the path shows the link-not-found page, the name stays reserved to this cohort, and the token link still works. '
          : ''}
        Works only while the cohort is open, and always lands on the current link — re-issuing the token
        does not break it. Leave blank for none.
      </p>
    </div>
  );
}

/**
 * Every link a cohort has ever been given, opened underneath its row.
 *
 * Loaded when the row is opened rather than with the list: a console showing
 * forty cohorts would otherwise fetch forty link histories nobody asked for.
 *
 * Two kinds live here. What is current — one open link per round, plus the
 * personal continuation links people received when they claimed a name — and
 * what was replaced, recovered from the activity log. A rotated token is gone
 * from the links table by design, so the log is the only record that it was
 * ever the address people were sent, and the only way to put it back.
 */
function CohortLinks({ cohortId }: { cohortId: string }) {
  interface LiveLink {
    linkId: string;
    kind: 'generic' | 'personal';
    roundNo: number;
    roundName: string;
    roundClosed: boolean;
    token: string | null;
    candidateEmail: string | null;
    active: boolean;
    createdAt: string;
    lastSeenAt: string | null;
    respondents: number;
  }
  interface OldLink {
    auditId: string;
    linkId: string | null;
    token: string;
    replacedAt: string;
    summary: string;
  }

  const [data, setData] = useState<{ live: LiveLink[]; superseded: OldLink[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const origin = typeof window === 'undefined' ? '' : window.location.origin;

  const load = useCallback(() => {
    api
      .get<{ live: LiveLink[]; superseded: OldLink[] }>(`/api/admin/cohorts/${cohortId}/links`)
      .then(setData)
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : 'Could not read this cohort’s links.'),
      );
  }, [cohortId]);

  useEffect(load, [load]);

  async function restore(entry: OldLink): Promise<void> {
    setBusy(true);
    try {
      const res = await api.post<{ url: string }>(
        `/api/admin/activity/${entry.auditId}/restore-link`,
      );
      await navigator.clipboard?.writeText(res.url).catch(() => undefined);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not restore that link.');
    } finally {
      setBusy(false);
    }
  }

  if (error) return <div className="dt-childbox dt-child-empty">{error}</div>;
  if (!data) return <div className="dt-childbox dt-child-empty">Reading the links…</div>;

  const rows = [
    ...data.live.map((l) => ({ sort: `2-${l.roundNo}-${l.kind}`, live: l, old: null as OldLink | null })),
    ...data.superseded.map((o) => ({ sort: `1-${o.replacedAt}`, live: null as LiveLink | null, old: o })),
  ];

  if (rows.length === 0) {
    return (
      <div className="dt-childbox dt-child-empty">
        No links yet. Open the cohort and issue one.
      </div>
    );
  }

  return (
    <div className="dt-childbox">
      {/* Its own scroller: six columns inside an indented row runs out of width
          on a laptop long before the page does. */}
      <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Link</th>
            <th>Round</th>
            <th>State</th>
            <th>Issued</th>
            <th>Last opened</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) =>
            r.live ? (
              <tr key={r.live.linkId}>
                <td>
                  <b>{r.live.kind === 'generic' ? 'Group link' : 'Personal link'}</b>
                  <div className="cell-sub">
                    {r.live.kind === 'personal'
                      ? (r.live.candidateEmail ?? 'a respondent')
                      : `${r.live.respondents} response${r.live.respondents === 1 ? '' : 's'} this round`}
                  </div>
                </td>
                <td>
                  {r.live.roundName}
                  <div className="cell-sub">{r.live.roundClosed ? 'closed' : 'taking responses'}</div>
                </td>
                <td>
                  {r.live.active ? (
                    <span className="pill pill-ok">Active</span>
                  ) : (
                    <span className="pill pill-warn">Disabled</span>
                  )}
                </td>
                <td className="nowrap">{formatDate(r.live.createdAt)}</td>
                <td className="nowrap">{r.live.lastSeenAt ? formatDate(r.live.lastSeenAt) : '—'}</td>
                <td className="row-actions">
                  {r.live.token ? (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() =>
                        void navigator.clipboard?.writeText(`${origin}/t/${r.live!.token}`)
                      }
                    >
                      Copy
                    </button>
                  ) : (
                    <span className="cell-sub">stored as a hash</span>
                  )}
                </td>
              </tr>
            ) : (
              <tr key={r.old!.auditId} className="is-muted">
                <td>
                  <b>Replaced link</b>
                  <div className="cell-sub">{r.old!.summary}</div>
                </td>
                <td>—</td>
                <td>
                  <span className="pill pill-plain">Superseded</span>
                </td>
                <td className="nowrap">{formatDate(r.old!.replacedAt)}</td>
                <td>—</td>
                <td className="row-actions">
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={busy}
                    onClick={() => void restore(r.old!)}
                  >
                    Put it back
                  </button>
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}

/**
 * The trend.
 *
 * Shown once a group has been asked twice, because before that there is no
 * movement to read — only a single reading, which the round's own report says
 * better.
 *
 * Engagement leads, deliberately. A block mean that rose while half the group
 * stopped answering has not risen, and putting the response rate underneath the
 * scores would let someone read the second number without the first.
 */
function TrendPanel({ cohortId }: { cohortId: string }) {
  const [trend, setTrend] = useState<CohortTrend | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || trend) return;
    api
      .get<CohortTrend>(`/api/admin/cohorts/${cohortId}/trend`)
      .then(setTrend)
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : 'Could not read the trend.'),
      );
  }, [cohortId, open, trend]);

  const pct = (v: number): string => `${Math.round(v * 100)}%`;
  const num = (v: number | null): string => (v === null ? '—' : v.toFixed(2));
  const delta = (v: number | null): string => (v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}`);

  return (
    <section className="card">
      <div className="card-body">
        <div className="panel-head">
          <h2>Trend</h2>
          <button className="btn btn-secondary btn-sm" onClick={() => setOpen((o) => !o)}>
            {open ? 'Hide the trend' : 'Show the trend'}
          </button>
        </div>
        <p className="hint">
          The same group across its rounds: how many answered, how much of the group each round
          actually covered, and where the four blocks moved.
        </p>

        {error ? <div className="banner is-shown">{error}</div> : null}

        {open && !trend && !error ? <p className="hint">Reading every round…</p> : null}

        {open && trend ? (
          <>
            <div className="table-scroll" style={{ marginTop: 12 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Round</th>
                    <th>Answered</th>
                    <th>Coverage</th>
                    <th>Ties</th>
                    <th>Reciprocity</th>
                    {trend.rounds[0]?.blocks.map((b) => (
                      <th key={b.blockKey}>{b.short}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {trend.rounds.map((r, i) => {
                    const prev = i > 0 ? trend.rounds[i - 1] : null;
                    return (
                      <tr key={r.no}>
                        <td>
                          <b>{r.name}</b>
                          <div className="cell-sub">
                            {r.closedAt ? 'closed' : 'open'}
                            {r.reportsReady ? ' · reported' : ''}
                          </div>
                        </td>
                        <td>
                          {r.respondents} of {r.rosterSize}
                          <div className="cell-sub">
                            {pct(r.responseRate)}
                            {prev ? ` (was ${pct(prev.responseRate)})` : ''}
                          </div>
                        </td>
                        <td>{pct(r.coverage)}</td>
                        <td>{num(r.density)}</td>
                        <td>{num(r.reciprocity)}</td>
                        {r.blocks.map((b, bi) => {
                          const before = prev?.blocks[bi]?.mean ?? null;
                          const moved = b.mean !== null && before !== null ? b.mean - before : null;
                          return (
                            <td key={b.blockKey}>
                              {num(b.mean)}
                              {moved !== null && Math.abs(moved) >= 0.01 ? (
                                <div className={`cell-sub ${moved > 0 ? 'is-up' : 'is-down'}`}>
                                  {delta(Math.round(moved * 100) / 100)}
                                </div>
                              ) : null}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {trend.movers.length > 0 ? (
              <>
                <h3 style={{ marginTop: 20 }}>Who moved most</h3>
                <p className="hint">
                  First round to last, across all four blocks. A leader rated by fewer than{' '}
                  {trend.minRaters} colleagues in either round shows a dash rather than a number.
                </p>
                <DataTable
                  rows={trend.movers}
                  rowKey={(m) => m.memberId}
                  pageSize={10}
                  minWidth={620}
                  columns={[
                    {
                      key: 'name',
                      header: 'Leader',
                      value: (m) => `${m.name} ${m.func}`,
                      cell: (m) => (
                        <>
                          <b>{m.name}</b>
                          {m.func ? <div className="cell-sub">{m.func}</div> : null}
                        </>
                      ),
                    },
                    {
                      key: 'first',
                      header: trend.rounds[0]?.name ?? 'First',
                      width: '140px',
                      align: 'right',
                      value: (m) => m.first ?? '',
                      cell: (m) => num(m.first),
                    },
                    {
                      key: 'last',
                      header: trend.rounds[trend.rounds.length - 1]?.name ?? 'Last',
                      width: '140px',
                      align: 'right',
                      value: (m) => m.last ?? '',
                      cell: (m) => num(m.last),
                    },
                    {
                      key: 'delta',
                      header: 'Change',
                      width: '110px',
                      align: 'right',
                      value: (m) => m.delta ?? '',
                      cell: (m) => (
                        <span className={m.delta === null ? '' : m.delta > 0 ? 'is-up' : 'is-down'}>
                          {delta(m.delta)}
                        </span>
                      ),
                    },
                  ]}
                />
              </>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}

/**
 * The rounds.
 *
 * A cohort is one group, asked more than once. Each wave has its own link, its
 * own responses and its own reports; the roster and its positions belong to the
 * cohort, which is what makes position 7 the same person in September and in
 * October.
 *
 * Starting a round closes the one before it and never touches its data: the old
 * link keeps resolving and says which wave it was for, the answers given
 * through it stay exactly as they were given, and its reports keep the tokens
 * already sent to the people they are about.
 */
function RoundsPanel({
  cohort,
  busy,
  onRun,
}: {
  cohort: CohortDetail;
  busy: boolean;
  onRun: <T>(fn: () => Promise<T>, success?: string) => Promise<T | null>;
}) {
  const [label, setLabel] = useState('');
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const rounds = [...cohort.rounds].reverse();

  return (
    <section className="card">
      <div className="card-body">
        <div className="panel-head">
          <h2>Rounds</h2>
          <span className="hint">
            {cohort.roundCount === 1 ? 'One wave so far' : `${cohort.roundCount} waves`}
          </span>
        </div>
        <p className="hint">
          Ask the same group again without losing what they said last time. A new round issues a new
          link and empties the roster's "already responded" marks; every previous round keeps its link,
          its answers and its reports.
        </p>

        <div className="inline-form">
          <input
            className="control control-sm"
            placeholder={`Name this round, e.g. ${new Date().toLocaleString('en-GB', { month: 'long' })} ${new Date().getFullYear()}`}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <button
            className="btn btn-primary btn-sm"
            disabled={busy || cohort.rosterSize < 2}
            onClick={() =>
              void onRun(async () => {
                const res = await api.post<{ roundName: string }>(
                  `/api/admin/cohorts/${cohort.id}/rounds`,
                  { label: label.trim() },
                );
                setLabel('');
                return res;
              }, 'New round started. Everyone can rate again on the new link.')
            }
          >
            Start a new round
          </button>
        </div>

        <DataTable
          rows={rounds}
          rowKey={(r) => String(r.no)}
          pageSize={10}
          minWidth={720}
          columns={[
            {
              key: 'round',
              header: 'Round',
              value: (r) => r.name,
              cell: (r) => (
                <>
                  <b>{r.name}</b>
                  <div className="cell-sub">{r.closedAt ? 'closed' : 'taking responses'}</div>
                </>
              ),
            },
            {
              key: 'opened',
              header: 'Opened',
              width: '130px',
              value: (r) => r.openedAt,
              cell: (r) => formatDate(r.openedAt),
            },
            {
              key: 'responses',
              header: 'Responses',
              width: '120px',
              align: 'right',
              value: (r) => r.respondents,
              cell: (r) => `${r.respondents} of ${cohort.rosterSize}`,
            },
            {
              key: 'reports',
              header: 'Reports',
              value: (r) =>
                r.reports.group ? `group ${r.reports.members} members` : 'not generated',
              cell: (r) =>
                r.reports.group
                  ? `Group + ${r.reports.members} member${r.reports.members === 1 ? '' : 's'}${
                      r.reports.suppressed > 0 ? ` (${r.reports.suppressed} withheld)` : ''
                    }`
                  : 'Not generated',
            },
            {
              key: 'link',
              header: 'Link',
              width: '96px',
              cell: (r) =>
                r.linkToken ? (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => void navigator.clipboard?.writeText(`${origin}/t/${r.linkToken}`)}
                  >
                    Copy
                  </button>
                ) : (
                  <span className="hint">—</span>
                ),
            },
          ]}
        />
      </div>
    </section>
  );
}

/**
 * The roster.
 *
 * Three ways in, because facilitators arrive with the list in different shapes:
 * a workbook they already have, a block of text they can paste, or one person
 * at a time. All three land in the same place.
 *
 * Removing someone deactivates them once anyone has answered anything — their
 * roster position is the address stored ratings point at, and freeing it would
 * let a later member inherit ratings meant for them. The row stays visible,
 * greyed, so the gap in the numbering reads as deliberate rather than as a bug.
 */
function RosterPanel({
  cohort,
  busy,
  onRun,
  rosterText,
  setRosterText,
}: {
  cohort: CohortDetail;
  busy: boolean;
  onRun: <T>(fn: () => Promise<T>, success?: string) => Promise<T | null>;
  rosterText: string;
  setRosterText: (v: string) => void;
}) {
  const [adding, setAdding] = useState({ name: '', func: '', email: '' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: '', func: '', email: '' });
  const [showPaste, setShowPaste] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const active = cohort.roster.filter((m) => m.active);

  function startEdit(m: CohortDetail['roster'][number]): void {
    setEditingId(m.memberId);
    setDraft({ name: m.name, func: m.func, email: m.email });
  }

  async function upload(file: File): Promise<void> {
    const buf = await file.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buf);
    // Chunked: a spread over a large array blows the argument limit.
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    await onRun(async () => {
      const parsed = await api.post<{ rows: { name: string; func: string; email: string }[]; skipped: string[] }>(
        `/api/admin/cohorts/${cohort.id}/roster/upload`,
        { fileBase64: btoa(binary), filename: file.name },
      );
      await api.put(`/api/admin/cohorts/${cohort.id}/roster`, { members: parsed.rows });
      return parsed;
    }, `Roster read from ${file.name}.`);
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <section className="card">
      <div className="card-body">
        <h2>Roster</h2>
        <p className="hint">
          The people in this group, and the order their ratings are stored against. A position is never
          reused: rename someone and their ratings follow, remove someone and their slot stays theirs.
        </p>

        <div className="btn-row">
          <button
            className="btn btn-secondary btn-sm"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            Upload a spreadsheet
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
          />
          <button className="btn btn-ghost btn-sm" onClick={() => setShowPaste((v) => !v)}>
            {showPaste ? 'Hide paste box' : 'Paste a list instead'}
          </button>
        </div>
        <p className="hint">
          An .xlsx whose first column is the name; function and email are taken from the next two, or
          from columns whose header says so. Uploading replaces the roster — matched names keep their
          position.
        </p>

        {showPaste ? (
          <>
            <textarea
              className="control"
              rows={6}
              placeholder={'Priya Raman, Manufacturing, priya@acme.com\nSam Okafor, Quality, sam@acme.com'}
              value={rosterText}
              onChange={(e) => setRosterText(e.target.value)}
            />
            <div className="btn-row">
              <button
                className="btn btn-primary btn-sm"
                disabled={busy || !rosterText.trim()}
                onClick={() =>
                  void onRun(async () => {
                    const parsed = await api.post<{ rows: { name: string; func: string; email: string }[] }>(
                      `/api/admin/cohorts/${cohort.id}/roster/parse`,
                      { text: rosterText },
                    );
                    if (parsed.rows.length === 0) throw new ApiError('Nothing readable in that paste.', 400);
                    await api.put(`/api/admin/cohorts/${cohort.id}/roster`, { members: parsed.rows });
                    setRosterText('');
                  }, 'Roster saved.')
                }
              >
                Replace roster with this
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() =>
                  setRosterText(
                    active.map((m) => [m.name, m.func, m.email].filter(Boolean).join(', ')).join('\n'),
                  )
                }
              >
                Load the current roster
              </button>
            </div>
          </>
        ) : null}

        <div style={{ marginTop: 18 }}>
          <DataTable
            rows={cohort.roster}
            rowKey={(m) => m.memberId}
            pageSize={25}
            minWidth={860}
            footer={
              <tr>
                <td className="num">
                  {cohort.roster.reduce((max, m) => Math.max(max, m.no), 0) + 1}
                </td>
                <td>
                  <input
                    className="control control-sm"
                    placeholder="Name"
                    value={adding.name}
                    onChange={(e) => setAdding({ ...adding, name: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="control control-sm"
                    placeholder="Function"
                    value={adding.func}
                    onChange={(e) => setAdding({ ...adding, func: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="control control-sm"
                    placeholder="Email"
                    value={adding.email}
                    onChange={(e) => setAdding({ ...adding, email: e.target.value })}
                  />
                </td>
                <td>—</td>
                <td className="row-actions">
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={busy || !adding.name.trim()}
                    onClick={() =>
                      void onRun(async () => {
                        await api.post(`/api/admin/cohorts/${cohort.id}/members`, adding);
                        setAdding({ name: '', func: '', email: '' });
                      }, `${adding.name.trim()} added.`)
                    }
                  >
                    Add person
                  </button>
                </td>
              </tr>
            }
            columns={[
              {
                key: 'no',
                header: '#',
                width: '56px',
                align: 'right',
                value: (m) => m.no,
                cell: (m) => m.no,
                className: 'num',
              },
              {
                key: 'name',
                header: 'Name',
                value: (m) => m.name,
                cell: (m) =>
                  editingId === m.memberId ? (
                    <input
                      className="control control-sm"
                      value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    />
                  ) : (
                    <>
                      {m.name}
                      {m.active ? null : <div className="cell-sub">removed</div>}
                    </>
                  ),
              },
              {
                key: 'func',
                header: 'Function',
                value: (m) => m.func,
                cell: (m) =>
                  editingId === m.memberId ? (
                    <input
                      className="control control-sm"
                      value={draft.func}
                      onChange={(e) => setDraft({ ...draft, func: e.target.value })}
                    />
                  ) : (
                    m.func || '—'
                  ),
              },
              {
                key: 'email',
                header: 'Email',
                value: (m) => m.email,
                cell: (m) =>
                  editingId === m.memberId ? (
                    <input
                      className="control control-sm"
                      value={draft.email}
                      onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                    />
                  ) : (
                    m.email || <span className="cell-sub">no email — cannot be sent a report</span>
                  ),
              },
              {
                key: 'responded',
                header: 'Responded',
                width: '110px',
                value: (m) => (m.responded ? 'yes' : 'no'),
                cell: (m) => (m.responded ? 'Yes' : '—'),
              },
              {
                key: 'actions',
                header: '',
                width: '180px',
                className: 'row-actions',
                cell: (m) =>
                  editingId === m.memberId ? (
                    <>
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={busy}
                        onClick={() =>
                          void onRun(async () => {
                            await api.patchJson(
                              `/api/admin/cohorts/${cohort.id}/members/${m.memberId}`,
                              draft,
                            );
                            setEditingId(null);
                          }, 'Saved.')
                        }
                      >
                        Save
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditingId(null)}>
                        Cancel
                      </button>
                    </>
                  ) : m.active ? (
                    <>
                      <button className="btn btn-ghost btn-sm" onClick={() => startEdit(m)}>
                        Edit
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={busy}
                        onClick={() =>
                          void onRun(
                            () => api.del(`/api/admin/cohorts/${cohort.id}/members/${m.memberId}`),
                            `${m.name} removed from the roster.`,
                          )
                        }
                      >
                        Remove
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() =>
                        void onRun(
                          () =>
                            api.post(
                              `/api/admin/cohorts/${cohort.id}/members/${m.memberId}/restore`,
                            ),
                          `${m.name} is back on the roster.`,
                        )
                      }
                    >
                      Put back
                    </button>
                  ),
              },
            ]}
          />
        </div>
      </div>
    </section>
  );
}

interface MemberLinkRow {
  memberId: string;
  name: string;
  email: string;
  url: string | null;
  status: 'issued' | 'already' | 'no_email';
  sent: boolean;
}

/**
 * Per-member magic links: one unguessable, already-bound door each — the
 * strongest identity the platform offers, with nothing to type and nobody to
 * impersonate. Freshly minted tokens are shown once, here, and can be mailed
 * straight to their owners.
 */
function MemberLinksPanel({
  cohort,
  busy,
  onRun,
}: {
  cohort: CohortDetail;
  busy: boolean;
  onRun: <T>(fn: () => Promise<T>, success?: string) => Promise<T | null>;
}) {
  const [links, setLinks] = useState<MemberLinkRow[] | null>(null);
  const [confirmRegen, setConfirmRegen] = useState(false);

  async function issue(opts: { send: boolean; regenerate?: boolean }): Promise<void> {
    setConfirmRegen(false);
    const res = await onRun(
      () =>
        api.post<{ links: MemberLinkRow[]; issued: number; already: number; noEmail: number; sent: number }>(
          `/api/admin/cohorts/${cohort.id}/member-links`,
          opts,
        ),
      undefined,
    );
    if (res) {
      setLinks(res.links);
      const bits = [`${res.issued} issued`];
      if (res.already) bits.push(`${res.already} already had one`);
      if (res.noEmail) bits.push(`${res.noEmail} without an email`);
      if (opts.send) bits.push(`${res.sent} emailed`);
      await onRun(async () => undefined, `Personal links: ${bits.join(', ')}.`);
    }
  }

  return (
    <section className="card">
      <div className="card-body">
        <h2>Personal links</h2>
        <p className="hint">
          Each person gets their own unguessable link, already signed in as them — nothing to type,
          nobody to impersonate. A person who already holds a link keeps it; freshly minted links are
          shown below <b>once</b>, so copy or email them now. Regenerating kills every old link.
        </p>

        <div className="btn-row">
          <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void issue({ send: false })}>
            Issue missing links
          </button>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void issue({ send: true })}>
            Issue + email everyone
          </button>
          {confirmRegen ? (
            <button
              className="btn btn-sm btn-secondary"
              style={{ color: 'var(--danger)', borderColor: 'var(--danger-line)' }}
              disabled={busy}
              onClick={() => void issue({ send: true, regenerate: true })}
            >
              Really regenerate — old links stop working
            </button>
          ) : (
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setConfirmRegen(true)}>
              Regenerate all + email
            </button>
          )}
        </div>

        {links ? (
          <DataTable
            rows={links}
            rowKey={(l) => l.memberId}
            pageSize={10}
            minWidth={640}
            columns={[
              { key: 'name', header: 'Person', value: (l) => l.name, cell: (l) => <b>{l.name}</b> },
              {
                key: 'email',
                header: 'Email',
                value: (l) => l.email,
                cell: (l) => l.email || <span className="cell-sub">none — add one on the roster</span>,
              },
              {
                key: 'status',
                header: 'Status',
                width: '130px',
                value: (l) => l.status,
                cell: (l) =>
                  l.status === 'issued' ? (
                    <span className="pill pill-ok">fresh link</span>
                  ) : l.status === 'already' ? (
                    <span className="pill pill-neutral">already has one</span>
                  ) : (
                    <span className="pill pill-plain">no email</span>
                  ),
              },
              {
                key: 'sent',
                header: 'Emailed',
                width: '84px',
                value: (l) => (l.sent ? 'yes' : ''),
                cell: (l) => (l.sent ? 'Yes' : '—'),
              },
              {
                key: 'url',
                header: 'Link (shown once)',
                cell: (l) =>
                  l.url ? (
                    <span className="mlink">
                      <code>{l.url.replace(/^https?:\/\//, '').slice(0, 34)}…</code>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => void navigator.clipboard?.writeText(l.url!)}
                      >
                        Copy
                      </button>
                    </span>
                  ) : (
                    <span className="cell-sub">—</span>
                  ),
              },
            ]}
          />
        ) : null}
      </div>
    </section>
  );
}

interface AssignmentRow {
  raterMemberId: string;
  targetMemberIds: string[];
}

/**
 * Who rates whom. Nothing here means the full matrix — everyone rates everyone
 * — which is what every cohort did before this panel existed. A map narrows
 * the exercise per rater; a rater left out of the map still sees everyone
 * (see migration 0016 for why the fallback is generous).
 */
function AssignmentsPanel({
  cohort,
  busy,
  onRun,
}: {
  cohort: CohortDetail;
  busy: boolean;
  onRun: <T>(fn: () => Promise<T>, success?: string) => Promise<T | null>;
}) {
  // `mapOf` is the local source of truth once loaded, so a checkbox ticks the
  // instant it is clicked rather than after a round trip — the earlier build
  // controlled every box straight off the server and re-rendered it unchanged
  // until the reload landed, which read as "the click did nothing". Saving is
  // fire-and-forget against the assignments endpoint alone; it never reloads
  // the whole cohort, so the roster below does not flash or disable mid-edit.
  const [mapOf, setMapOf] = useState<Map<string, Set<string>> | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const res = await api.get<{ assignments: AssignmentRow[] }>(
      `/api/admin/cohorts/${cohort.id}/assignments`,
    );
    setMapOf(new Map(res.assignments.map((r) => [r.raterMemberId, new Set(r.targetMemberIds)])));
  }, [cohort.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = cohort.roster.filter((m) => m.active);
  const byId = new Map(active.map((m) => [m.memberId, m]));

  async function save(next: Map<string, Set<string>>): Promise<void> {
    setMapOf(next); // optimistic — the UI is already showing this
    setSaveState('saving');
    try {
      await api.put(`/api/admin/cohorts/${cohort.id}/assignments`, {
        assignments: [...next.entries()]
          .filter(([, set]) => set.size > 0)
          .map(([raterMemberId, set]) => ({ raterMemberId, targetMemberIds: [...set] })),
      });
      setSaveState('saved');
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaveState('idle'), 1500);
    } catch {
      // The server refused — pull the truth back so the screen never lies about
      // what is stored.
      setSaveState('error');
      await load();
    }
  }

  function toggle(raterId: string, targetId: string): void {
    if (!mapOf) return;
    const next = new Map([...mapOf.entries()].map(([k, v]) => [k, new Set(v)]));
    // An unmapped rater rates everyone. The first click on their grid is
    // "everyone *except* this one", so it is materialised from the full roster
    // rather than started as a set of one — the opposite of what the old code did.
    const set =
      next.get(raterId) ??
      new Set(active.filter((t) => t.memberId !== raterId).map((t) => t.memberId));
    if (set.has(targetId)) set.delete(targetId);
    else set.add(targetId);
    next.set(raterId, set);
    void save(next);
  }

  function resetRater(raterId: string): void {
    if (!mapOf) return;
    const next = new Map([...mapOf.entries()].map(([k, v]) => [k, new Set(v)]));
    next.delete(raterId); // no key = unmapped = rates everyone
    void save(next);
  }

  async function upload(file: File): Promise<void> {
    const buf = await file.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    const out = await onRun(async () => {
      const parsed = await api.post<{ assignments: AssignmentRow[]; unmatched: string[] }>(
        `/api/admin/cohorts/${cohort.id}/assignments/upload`,
        { fileBase64: btoa(binary), filename: file.name },
      );
      await api.put(`/api/admin/cohorts/${cohort.id}/assignments`, {
        assignments: parsed.assignments,
      });
      await load();
      setSaveState('idle');
      return parsed;
    }, 'Mapping sheet applied.');
    if (out) {
      setUploadNote(
        `Mapped ${out.assignments.length} raters to ${out.assignments.reduce((n, a) => n + a.targetMemberIds.length, 0)} pairs from ${file.name}.` +
          (out.unmatched.length > 0
            ? ` ${out.unmatched.length} name${out.unmatched.length === 1 ? '' : 's'} did not match the roster: ${out.unmatched.slice(0, 5).join(', ')}${out.unmatched.length > 5 ? '…' : ''}`
            : ''),
      );
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  const mapped = mapOf ? [...mapOf.values()].filter((s) => s.size > 0).length : 0;

  return (
    <section className="card">
      <div className="card-body">
        <div className="net-head">
          <h2>Who rates whom</h2>
          <span className={`save-badge is-${saveState === 'idle' ? 'saved' : saveState}`} role="status">
            {saveState === 'saving'
              ? 'Saving…'
              : saveState === 'error'
                ? 'Save failed — reloaded'
                : saveState === 'saved'
                  ? 'Saved'
                  : ''}
          </span>
        </div>
        <p className="hint">
          {mapped === 0
            ? 'Full matrix — every respondent rates the whole roster. Upload a mapping sheet, or open a person below, to narrow it.'
            : `${mapped} of ${active.length} raters are mapped. A mapped rater sees only their targets; anyone unmapped still sees everyone.`}
        </p>

        <div className="btn-row">
          <button
            className="btn btn-secondary btn-sm"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            Upload mapping sheet
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = '';
            }}
          />
          {mapped > 0 ? (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => void save(new Map())}
            >
              Clear the map
            </button>
          ) : null}
        </div>
        <p className="hint">
          Two sheet shapes are read: a matrix (targets across the top, raters down the side, any mark
          in a cell) or a list (rater in the first column, their targets in the cells beside them).
          Names must match the roster.
        </p>
        {uploadNote ? (
          <p className="hint" role="status">
            <b>{uploadNote}</b>
          </p>
        ) : null}

        {mapOf === null ? (
          <TableSkeleton rows={4} cols={3} />
        ) : (
          <DataTable
            rows={active}
            rowKey={(m) => m.memberId}
            pageSize={10}
            minWidth={520}
            expandLabel={(m) => `Edit who ${m.name} rates`}
            expand={(m) => {
              const set = mapOf.get(m.memberId);
              return (
                <div className="assign-grid">
                  {active
                    .filter((t) => t.memberId !== m.memberId)
                    .map((t) => (
                      <label key={t.memberId} className="assign-cell">
                        <input
                          type="checkbox"
                          checked={set ? set.has(t.memberId) : true}
                          onChange={() => toggle(m.memberId, t.memberId)}
                        />
                        {t.name}
                      </label>
                    ))}
                  {set && set.size > 0 ? (
                    <button type="button" className="link-btn assign-note" onClick={() => resetRater(m.memberId)}>
                      Reset {m.name} to everyone
                    </button>
                  ) : (
                    <p className="hint assign-note">
                      Unmapped — sees everyone. Untick a name to start a map for {m.name}.
                    </p>
                  )}
                </div>
              );
            }}
            columns={[
              { key: 'name', header: 'Rater', value: (m) => m.name, cell: (m) => <b>{m.name}</b> },
              { key: 'func', header: 'Function', value: (m) => m.func, cell: (m) => m.func || '—' },
              {
                key: 'targets',
                header: 'Rates',
                value: (m) => mapOf.get(m.memberId)?.size ?? active.length - 1,
                cell: (m) => {
                  const set = mapOf.get(m.memberId);
                  if (!set || set.size === 0) return <span className="cell-sub">everyone ({active.length - 1})</span>;
                  const names = [...set]
                    .map((id) => byId.get(id)?.name)
                    .filter(Boolean)
                    .slice(0, 4);
                  return (
                    <>
                      <b>{set.size}</b>{' '}
                      <span className="cell-sub" style={{ display: 'inline' }}>
                        — {names.join(', ')}
                        {set.size > names.length ? '…' : ''}
                      </span>
                    </>
                  );
                },
              },
            ]}
          />
        )}
      </div>
    </section>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="co-stat">
      <span className="co-stat-label">{label}</span>
      <span className="co-stat-value">{value}</span>
      <span className="co-stat-note">{note}</span>
    </div>
  );
}

function formatDate(value: string): string {
  const d = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
