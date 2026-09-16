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
import { CardHead, DataTable, EmptyState, Head, TableSkeleton, Toast, useToast } from './ui.js';
import { CohortNetworkCard } from './network/CohortNetworkCard.js';
import { TENURE_BANDS } from '../../../src/shared/types.js';
import { cohortIdentityMode, cohortIdentityPatch } from '../../../src/shared/cohort-identity.js';
import type { CohortIdentityMode } from '../../../src/shared/cohort-identity.js';
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
  // Creating is the rare visit. Someone with forty cohorts came here to open
  // one, and an always-open create form put a two-column upload panel between
  // them and the list every single time.
  const [showCreate, setShowCreate] = useState(false);
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
      setShowCreate(false);
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
      setShowCreate(false);
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

  // An empty console has nothing to hide the create panel behind, so it opens
  // itself: the first visit is the one that needs the upload path explained.
  const isEmpty = cohorts !== null && cohorts.length === 0;
  const createOpen = showCreate || isEmpty;

  return (
    <>
      <Head
        title="Cohorts"
        sub="One cohort is one run of the instrument on one intact group — a roster, its rounds, and the reports they produce."
        actions={
          isEmpty ? null : (
            <button
              className={`btn btn-sm ${createOpen ? 'btn-secondary' : 'btn-primary'}`}
              aria-expanded={createOpen}
              onClick={() => setShowCreate((v) => !v)}
            >
              {createOpen ? 'Close' : 'New cohort'}
            </button>
          )
        }
      />
      <Toast message={toast} />

      {createOpen ? (
      <section className="card mb-4">
        <CardHead
          title="New cohort"
          sub="Two ways in: the client's spreadsheet in one motion, or an empty cohort you fill afterwards."
        />
        <div className="card-body">
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

          {error ? <div className="banner is-shown" role="alert">{error}</div> : null}
        </div>
      </section>
      ) : null}

      {error && !createOpen ? <div className="banner is-shown" role="alert">{error}</div> : null}

      <section className="card">
        <CardHead
          title="All cohorts"
          sub={cohorts === null ? undefined : `${cohorts.length} in the console`}
        />
        <div className="card-body">
          {cohorts === null ? <TableSkeleton rows={5} cols={6} /> : null}
          <DataTable
            expand={(c) => <CohortLinks cohortId={c.id} />}
            expandLabel={(c) => `Show every link issued for ${c.name}`}
            rows={cohorts ?? []}
            rowKey={(c) => c.id}
            minWidth={880}
            empty={
              cohorts === null ? (
                <></>
              ) : (
                <EmptyState
                  title="No cohorts yet"
                  body="A cohort is one intact group asked about each other. Upload the client's roster spreadsheet above and the whole thing is built in one motion, or start an empty one and add people inside it."
                />
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
                cell: (c) => <span className={`pill ${statusPill(c.status)} co-status`}>{c.status}</span>,
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
                // The one column that moves on its own. A bare count made the
                // reader do the division against the roster column two cells
                // away; the bar answers "how far along is this one" at a glance
                // down the table, and the numbers stay for the exact answer.
                key: 'responded',
                header: 'Responded',
                width: '148px',
                value: (c) => c.respondents,
                cell: (c) => {
                  const pct =
                    c.rosterSize > 0 ? Math.round((c.respondents / c.rosterSize) * 100) : 0;
                  return (
                    <>
                      <span className="co-cellmeter-val num">
                        {c.respondents} of {c.rosterSize}
                        {c.rosterSize > 0 ? <em> · {pct}%</em> : null}
                      </span>
                      <span
                        className="progress-strip progress-strip-sm"
                        role="progressbar"
                        aria-valuenow={pct}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`${pct}% of ${c.name} has responded`}
                      >
                        <i style={{ transform: `scaleX(${pct / 100})` }} />
                      </span>
                    </>
                  );
                },
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

/**
 * One cohort, opened.
 *
 * The screen is a standing header plus five tabs, and the split between them is
 * the point. The header carries what stays true whichever tab you are on — who
 * this group is, whether the exercise is running, how much of it has come back,
 * and the two verbs that change those answers. The tabs carry the work, one
 * subject each, at full width and full size.
 *
 * The five subjects are the facilitator's actual order of operations: build the
 * roster, decide how people get in, run the waves, watch the network form, hand
 * out the reports. An earlier build had two tabs — a map, and an "Info" that was
 * seven unrelated panels stacked half a screen apart — which meant every job
 * except reading the map began with a scroll to find where it lived.
 */
const COHORT_TABS = [
  ['network', 'Network'],
  ['roster', 'Roster'],
  ['access', 'Access'],
  ['rounds', 'Rounds'],
  ['reports', 'Reports'],
] as const;

type CohortTab = (typeof COHORT_TABS)[number][0];

function isCohortTab(v: string | null): v is CohortTab {
  return v !== null && COHORT_TABS.some(([k]) => k === v);
}

/**
 * Where an unparameterised open lands. A cohort too small to run wants the
 * roster; one with a roster but no way in wants Access; anything past that has
 * a network worth looking at, which is the reason the console exists.
 */
function defaultTab(cohort: CohortDetail): CohortTab {
  if (cohort.rosterSize < 2) return 'roster';
  if (!cohort.linkToken && cohort.personalLinkCount === 0) return 'access';
  return 'network';
}

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
  // The tab lives in the URL too (?tab=roster), so a reload keeps the view and
  // a pasted link opens where the sender was.
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const setActiveTab = useCallback(
    (tab: CohortTab) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('tab', tab);
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
        <button className="btn btn-secondary btn-sm" onClick={onClose}>
          Back to cohorts
        </button>
      </>
    );
  }

  const responded = cohort.roster.filter((m) => m.responded).length;
  const pct = cohort.rosterSize > 0 ? Math.round((responded / cohort.rosterSize) * 100) : 0;
  const activeTab: CohortTab = isCohortTab(tabParam) ? tabParam : defaultTab(cohort);

  return (
    <div className="cohort-detail">
      {/* Sticky, because the two verbs below and the response count are the
          answers you come back to from every tab. */}
      <header className="co-hero">
        <div className="co-hero-top">
          <button className="co-back" onClick={onClose} aria-label="Back to all cohorts" title="All cohorts">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>

          <div className="co-hero-id">
            <h1 className="co-hero-name">{cohort.name}</h1>
            <p className="co-hero-meta">
              {cohort.organisation ? <span>{cohort.organisation}</span> : null}
              <span>
                {cohort.roundName}
                {cohort.roundCount > 1 ? ` · ${cohort.roundCount} waves` : ''}
              </span>
            </p>
          </div>

          <span className={`pill ${statusPill(cohort.status)} co-status co-hero-status`}>{cohort.status}</span>

          {/* Opening and closing the exercise, and the link that opens it, are
              cohort-level verbs rather than the property of any one tab. */}
          <div className="co-hero-actions">
            {cohort.status !== 'open' ? (
              <button
                className="btn btn-primary btn-sm"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => api.patchJson(`/api/admin/cohorts/${cohortId}`, { status: 'open' }),
                    'Cohort opened. Share the link from Access.',
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
            {link ? (
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  void navigator.clipboard?.writeText(link);
                  showToast('Group link copied.');
                }}
              >
                Copy link
              </button>
            ) : (
              <button className="btn btn-secondary btn-sm" onClick={() => setActiveTab('access')}>
                Issue a link
              </button>
            )}
          </div>
        </div>

        <div className="co-hero-stats">
          {/* Responses lead and get the width: it is the one number that moves
              on its own while the facilitator is doing something else. */}
          <div className="co-progress">
            <div className="co-progress-head">
              <span className="co-stat-label">Responded</span>
              <span className="co-progress-val num">
                {responded} of {cohort.rosterSize}
                <em>{cohort.rosterSize > 0 ? ` · ${pct}%` : ''}</em>
              </span>
            </div>
            <div
              className="progress-strip"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Share of the roster that has responded"
            >
              <i style={{ transform: `scaleX(${pct / 100})` }} />
            </div>
          </div>

          <Stat label="Roster" value={String(cohort.rosterSize)} note="active members" />
          <Stat label="Rater floor" value={String(cohort.minRaters)} note="for an individual report" />
          <Stat label="Tie threshold" value={String(cohort.tieThreshold)} note="counted as a tie" />
        </div>
      </header>

      {/* A sibling of the header, not a child of it. Sticky is bounded by the
          containing block, and the header ends at the tab row — nested, the
          tabs had a sticky range of zero pixels and simply scrolled away. */}
      <nav className="co-tabs" role="tablist" aria-label="Cohort views">
        {COHORT_TABS.map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={activeTab === k}
            className={`co-tab${activeTab === k ? ' is-on' : ''}`}
            onClick={() => setActiveTab(k)}
          >
            {label}
          </button>
        ))}
      </nav>

      {error ? <div className="banner is-shown">{error}</div> : null}

      <div className="co-tabpanel" role="tabpanel" key={activeTab}>
        {activeTab === 'network' ? (
          <CohortNetworkCard cohortId={cohortId} roundCount={cohort.roundCount} fullBleed />
        ) : null}

        {activeTab === 'roster' ? (
          <>
            <RosterPanel
              cohort={cohort}
              busy={busy}
              onRun={run}
              rosterText={rosterText}
              setRosterText={setRosterText}
            />
            <AssignmentsPanel cohort={cohort} busy={busy} onRun={run} />
          </>
        ) : null}

        {activeTab === 'access' ? (
          <>
            <AccessPanel cohort={cohort} busy={busy} onRun={run} link={link} setLink={setLink} />
            <MemberLinksPanel cohort={cohort} busy={busy} onRun={run} />
          </>
        ) : null}

        {activeTab === 'rounds' ? (
          <>
            <RoundsPanel cohort={cohort} busy={busy} onRun={run} />
            {cohort.roundCount > 1 ? <TrendPanel cohortId={cohortId} /> : null}
          </>
        ) : null}

        {activeTab === 'reports' ? (
          <ReportsPanel
            cohort={cohort}
            reports={reports}
            responded={responded}
            busy={busy}
            onRun={run}
            showToast={showToast}
          />
        ) : null}
      </div>

      <Toast message={toast} />
    </div>
  );
}

/**
 * How people get in: the shared link, its readable alias, and the rule that
 * decides who a respondent is allowed to claim to be.
 *
 * These three used to sit at the top of a general "Info" panel above four
 * unrelated ones. They belong together because they are one decision made in
 * three parts — a facilitator changing the identity rule almost always re-issues
 * or re-shares the link in the same sitting.
 */
function AccessPanel({
  cohort,
  busy,
  onRun,
  link,
  setLink,
}: {
  cohort: CohortDetail;
  busy: boolean;
  onRun: <T>(fn: () => Promise<T>, success?: string) => Promise<T | null>;
  link: string | null;
  setLink: (v: string) => void;
}) {
  return (
    <section className="card">
      <CardHead
        title="The shared link"
        sub="One link for the whole group. Everyone opens the same address and identifies themselves from the roster."
        aside={
          <button
            className="btn btn-secondary btn-sm"
            disabled={busy}
            onClick={() =>
              void onRun(async () => {
                const res = await api.post<{ url: string }>(`/api/admin/cohorts/${cohort.id}/link`);
                setLink(res.url);
              }, 'Link issued. Any copy of the previous link has stopped working.')
            }
          >
            {link ? 'Re-issue' : 'Issue the link'}
          </button>
        }
      />
      <div className="card-body">
        {link ? (
          <>
            <div className="linkbox">
              <code>{link}</code>
              <button className="btn btn-ghost btn-sm" onClick={() => void navigator.clipboard?.writeText(link)}>
                Copy
              </button>
            </div>
            <ShortLink cohort={cohort} busy={busy} onRun={onRun} />
          </>
        ) : (
          <EmptyState
            title="No link yet"
            body="Issue one once the roster is right. Everyone in the group uses the same link and identifies themselves from the roster when they open it."
          />
        )}

        <IdentityModePicker cohort={cohort} busy={busy} onRun={onRun} />
      </div>
    </section>
  );
}

/**
 * Generating, sharing and sending the reports.
 *
 * The rater floor is stated before the button rather than after it: a cohort
 * nobody has answered would otherwise produce a "ready" report of an empty
 * network, and one or two responses would produce a group report that is one
 * person's opinions with the name taken off.
 */
function ReportsPanel({
  cohort,
  reports,
  responded,
  busy,
  onRun,
  showToast,
}: {
  cohort: CohortDetail;
  reports: CohortReportRow[];
  responded: number;
  busy: boolean;
  onRun: <T>(fn: () => Promise<T>, success?: string) => Promise<T | null>;
  showToast: (message: string) => void;
}) {
  const cohortId = cohort.id;
  const short = responded < cohort.minRaters;

  return (
    <section className="card">
      <CardHead
        title="Reports"
        sub={`One group report plus one per member. A member rated by fewer than ${cohort.minRaters} colleagues is withheld rather than reported — an average of one or two responses in a named group identifies who gave them.`}
        aside={
          <button
            className="btn btn-primary btn-sm"
            disabled={busy || short}
            title={short ? `Needs at least ${cohort.minRaters} responses` : undefined}
            onClick={() =>
              void onRun(async () => {
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
            {reports.length > 0 ? 'Re-generate' : 'Generate reports'}
          </button>
        }
      />
      <div className="card-body">
        {short ? (
          <div className="notice" role="status">
            <b>
              {responded === 0
                ? 'Nobody has responded yet.'
                : `${responded} of ${cohort.rosterSize} ${responded === 1 ? 'has' : 'have'} responded.`}
            </b>{' '}
            Reports need at least {cohort.minRaters} responses, for the group as well as for each member —
            share the link and come back.
          </div>
        ) : null}

        {/* The completion screen's promise is controlled from here. Off — the
            default — respondents are thanked and told nothing about reports;
            their profiles still exist for the facilitator to hand over however
            the engagement calls for. On, the completion screen says a summary
            is coming by email, so only turn it on when that is actually the
            plan. */}
        <div className="share-toggle">
          <div>
            <b>Share reports with participants</b>
            <p className="hint">
              {cohort.shareReports
                ? 'On — the completion screen tells each respondent a personal summary will be emailed to them. Turning it off stops that promise for anyone who finishes afterwards.'
                : 'Off — respondents see a plain thank-you when they finish. No report, PDF or email is mentioned to them.'}
            </p>
          </div>
          <button
            className={`btn btn-sm ${cohort.shareReports ? 'btn-secondary' : 'btn-primary'}`}
            disabled={busy}
            onClick={() =>
              void onRun(
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

        {reports.length === 0 ? (
          <EmptyState
            title="Nothing generated yet"
            body={
              short
                ? 'Reports appear here once enough of the group has answered and you generate them.'
                : 'Enough of the group has answered. Generate the reports to produce the group map and each member’s own.'
            }
          />
        ) : (
          <div className="mt-4">
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
                              void onRun(
                                () => api.post(`/api/admin/cohorts/${cohortId}/reports/${r.id}/send`),
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
                              void onRun(async () => {
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
      <CardHead
        title="Trend"
        sub="The same group across its rounds: how many answered, how much of the group each round actually covered, and where the four blocks moved."
        aside={
          <button className="btn btn-secondary btn-sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? 'Hide the trend' : 'Show the trend'}
          </button>
        }
      />
      <div className="card-body">
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
      <CardHead
        title="Rounds"
        sub={`Ask the same group again without losing what they said last time. A new round issues a new link and empties the roster's "already responded" marks; every previous round keeps its link, its answers and its reports.`}
        aside={
          <span className="pill pill-plain">
            {cohort.roundCount === 1 ? 'One wave so far' : `${cohort.roundCount} waves`}
          </span>
        }
      />
      <div className="card-body">
        <div className="inline-form inline-form-first">
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
/**
 * One member as the editor holds them, which is not quite how the API states
 * them. Both optional attributes are absent far more often than they are set,
 * and a `<select>` has exactly one way to say "nothing chosen" — the empty
 * string. So the editor keeps them as strings and `memberBody` turns the empty
 * one back into the null the API means by it, rather than sprinkling the
 * conversion through the JSX.
 */
interface MemberDraft {
  name: string;
  func: string;
  email: string;
  tenureBand: string;
  reportsTo: string;
}

const EMPTY_MEMBER: MemberDraft = { name: '', func: '', email: '', tenureBand: '', reportsTo: '' };

function memberBody(d: MemberDraft): Record<string, unknown> {
  return {
    name: d.name,
    func: d.func,
    email: d.email,
    tenureBand: d.tenureBand === '' ? null : d.tenureBand,
    reportsTo: d.reportsTo === '' ? null : Number(d.reportsTo),
  };
}

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
  const [adding, setAdding] = useState<MemberDraft>(EMPTY_MEMBER);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<MemberDraft>(EMPTY_MEMBER);
  const [showPaste, setShowPaste] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const active = cohort.roster.filter((m) => m.active);
  const nameOfNo = new Map(cohort.roster.map((m) => [m.no, m.name]));

  function startEdit(m: CohortDetail['roster'][number]): void {
    setEditingId(m.memberId);
    setDraft({
      name: m.name,
      func: m.func,
      email: m.email,
      tenureBand: m.tenureBand ?? '',
      reportsTo: m.reportsTo === null || m.reportsTo === undefined ? '' : String(m.reportsTo),
    });
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
      <CardHead
        title="Roster"
        sub="The people in this group, and the order their ratings are stored against. A position is never reused: rename someone and their ratings follow, remove someone and their slot stays theirs. Tenure and reporting line are optional — lenses for reading the network afterwards, and nothing about the exercise waits on them."
        aside={<span className="pill pill-plain">{`${active.length} active`}</span>}
      />
      <div className="card-body">
        <div className="btn-row btn-row-first">
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
            // Sized to fit a 1440 viewport with the sidebar open rather than to
            // the columns' natural widths: at 1130 the actions column sat just
            // past the card edge, so every row ended in a half-drawn button and
            // a scrollbar to reach it.
            minWidth={1060}
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
                <td>
                  <select
                    className="control control-sm"
                    value={adding.tenureBand}
                    onChange={(e) => setAdding({ ...adding, tenureBand: e.target.value })}
                    aria-label="Tenure band"
                  >
                    <option value="">—</option>
                    {TENURE_BANDS.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    className="control control-sm"
                    value={adding.reportsTo}
                    onChange={(e) => setAdding({ ...adding, reportsTo: e.target.value })}
                    aria-label="Reports to"
                  >
                    <option value="">—</option>
                    {active.map((o) => (
                      <option key={o.memberId} value={String(o.no)}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>—</td>
                <td className="row-actions">
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={busy || !adding.name.trim()}
                    onClick={() =>
                      void onRun(async () => {
                        await api.post(`/api/admin/cohorts/${cohort.id}/members`, memberBody(adding));
                        setAdding(EMPTY_MEMBER);
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
                key: 'tenure',
                header: 'Tenure',
                width: '110px',
                value: (m) => m.tenureBand ?? '',
                cell: (m) =>
                  editingId === m.memberId ? (
                    <select
                      className="control control-sm"
                      value={draft.tenureBand}
                      onChange={(e) => setDraft({ ...draft, tenureBand: e.target.value })}
                      aria-label="Tenure band"
                    >
                      <option value="">—</option>
                      {TENURE_BANDS.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  ) : (
                    (m.tenureBand ?? '—')
                  ),
              },
              {
                key: 'reportsTo',
                header: 'Reports to',
                width: '160px',
                value: (m) => (m.reportsTo == null ? '' : (nameOfNo.get(m.reportsTo) ?? '')),
                cell: (m) =>
                  editingId === m.memberId ? (
                    <select
                      className="control control-sm"
                      value={draft.reportsTo}
                      onChange={(e) => setDraft({ ...draft, reportsTo: e.target.value })}
                      aria-label="Reports to"
                    >
                      <option value="">—</option>
                      {/* Never themselves: the server refuses it, so the list
                          does not offer it. */}
                      {active
                        .filter((o) => o.memberId !== m.memberId)
                        .map((o) => (
                          <option key={o.memberId} value={String(o.no)}>
                            {o.name}
                          </option>
                        ))}
                    </select>
                  ) : m.reportsTo == null ? (
                    '—'
                  ) : (
                    // A manager taken off the roster leaves the line pointing at
                    // a position nobody holds. Say so rather than showing blank.
                    (nameOfNo.get(m.reportsTo) ?? (
                      <span className="cell-sub">position {m.reportsTo}, no longer on the roster</span>
                    ))
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
                              memberBody(draft),
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

/**
 * How this cohort decides who somebody is — one choice of three, not two
 * unrelated switches.
 *
 * The stored flags are still two (`otpRequired`, `linkOnlyIdentity`), because
 * keeping them apart is what lets a code requirement survive a spell on
 * personal links. But a facilitator reasons about one question with three
 * answers, and offering it as two toggles invited the fourth combination that
 * means nothing: a code requirement on a cohort that no longer asks for an
 * email. `cohortIdentityPatch` is the single place the three answers become
 * flags, shared with the Worker that enforces them.
 */
function IdentityModePicker({
  cohort,
  busy,
  onRun,
}: {
  cohort: CohortDetail;
  busy: boolean;
  onRun: <T>(fn: () => Promise<T>, success?: string) => Promise<T | null>;
}) {
  const current = cohortIdentityMode(cohort);
  const missingLinks = Math.max(0, cohort.rosterSize - cohort.personalLinkCount);

  const options: { mode: CohortIdentityMode; label: string; note: string; done: string }[] = [
    {
      mode: 'open',
      label: 'Open',
      note: 'respondents pick their name and confirm by work email',
      done: 'Identity set to open — the enrolled work email alone opens the exercise.',
    },
    {
      mode: 'otp',
      label: 'Email + code',
      note: 'a one-time code is mailed and must be typed back',
      done: 'Identity set to email + code — every respondent must confirm a mailed 6-digit code.',
    },
    {
      mode: 'link_only',
      label: 'Personal links only',
      note: 'each member enters by their own emailed link; the shared link stops accepting identities',
      done: 'Identity set to personal links only — the shared link no longer accepts an identity.',
    },
  ];

  return (
    <div className="share-toggle identity-modes">
      <div>
        <b>Identity</b>
        <p className="hint" style={{ margin: '2px 0 6px' }}>
          How someone proves which roster position is theirs before they can rate anybody.
        </p>

        <div className="identity-choices" role="radiogroup" aria-label="Identity">
          {options.map((o) => (
            <label key={o.mode} className={`identity-choice${current === o.mode ? ' is-on' : ''}`}>
              <input
                type="radio"
                name={`identity-${cohort.id}`}
                checked={current === o.mode}
                disabled={busy}
                onChange={() => {
                  if (current === o.mode) return;
                  void onRun(
                    () => api.patchJson(`/api/admin/cohorts/${cohort.id}`, cohortIdentityPatch(o.mode)),
                    o.done,
                  );
                }}
              />
              <span>
                <b>{o.label}</b> — {o.note}
              </span>
            </label>
          ))}
        </div>

        {/* A shut front door and no keys handed out is not security, it is a
            locked-out cohort — and it looks identical to the facilitator until
            somebody emails to say the link does nothing. */}
        {current === 'link_only' && missingLinks > 0 ? (
          <div className="banner is-shown" style={{ marginTop: 8, marginBottom: 0 }}>
            <span>
              {missingLinks} of {cohort.rosterSize} members have no personal link yet — issue links
              below or they cannot enter.
            </span>
          </div>
        ) : null}
      </div>
    </div>
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
      <CardHead
        title="Personal links"
        sub="Each person gets their own unguessable link, already signed in as them — nothing to type, nobody to impersonate. A person who already holds a link keeps it."
      />
      <div className="card-body">
        <div className="notice" role="note">
          Freshly minted links are shown below <b>once</b>, so copy or email them before you leave this
          panel. Regenerating kills every link already in someone's inbox.
        </div>

        <div className="btn-row btn-row-first">
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
      <CardHead
        title="Who rates whom"
        sub={
          mapped === 0
            ? 'Full matrix — every respondent rates the whole roster. Upload a mapping sheet, or open a person below, to narrow it.'
            : `${mapped} of ${active.length} raters are mapped. A mapped rater sees only their targets; anyone unmapped still sees everyone.`
        }
        aside={
          <span className={`save-badge is-${saveState === 'idle' ? 'saved' : saveState}`} role="status">
            {saveState === 'saving'
              ? 'Saving…'
              : saveState === 'error'
                ? 'Save failed — reloaded'
                : saveState === 'saved'
                  ? 'Saved'
                  : ''}
          </span>
        }
      />
      <div className="card-body">
        <div className="btn-row btn-row-first">
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

/**
 * One figure in the standing header. The label sits above rather than beside:
 * the four of them line up as a row of readings, and a reading whose caption is
 * inline with it stops being scannable the moment one value is wider than the
 * rest.
 */
function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="co-stat">
      <span className="co-stat-label">{label}</span>
      <span className="co-stat-value num">{value}</span>
      <span className="co-stat-note">{note}</span>
    </div>
  );
}

function formatDate(value: string): string {
  const d = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
