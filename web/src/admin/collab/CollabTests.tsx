/**
 * Collaboration Tests: the runs a facilitator has set up, and one run's results.
 *
 * A run is one organisation diagnosed at one point in time. Two runs never
 * pool into one average, and a wave is the same organisation asked again
 * later, so the list is a list of runs and the wave is chosen inside one.
 *
 * The run page is tabbed rather than one column. Reading results, chasing
 * fifty people and setting the run up are three different jobs done at three
 * different moments, and stacking them made a page four thousand pixels long
 * where the thing you came for was usually at the bottom.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../../lib/api.js';
import {
  CardHead,
  DataTable,
  EmptyState,
  ErrorState,
  Head,
  Loading,
  Toast,
  formatDate,
  useToast,
} from '../ui.js';
import { RunResults } from './RunResults.js';
import { RunSetup } from './RunSetup.js';
import { RunTrend } from './RunTrend.js';
import { RosterPanel } from './RosterPanel.js';
import { ResponsesPanel } from './ResponsesPanel.js';
import type { RunListItem } from './types.js';

interface RunDetail {
  run: {
    id: string;
    name: string;
    organisation: string;
    status: 'draft' | 'open' | 'closed';
    min_segment: number;
    anonymous: boolean;
    anonymityEditable: boolean;
    shareSheets: boolean;
    openQuestion: string;
    reminderDays: number[];
    closesAt: string | null;
    archived: boolean;
    benchmarkOptIn: boolean;
    otpRequired: boolean;
    linkOnlyIdentity: boolean;
  };
  waves: { no: number; label: string; opened_at: string; closed_at: string | null; completed: number }[];
  facets: { key: string; label: string; options: string[]; required: boolean }[];
  turnout: { invited: number; started: number; completed: number } | null;
}

/** A run is draft, open or closed — never "invited", which is a response's word. */
function RunStatus({ status }: { status: 'draft' | 'open' | 'closed' }) {
  if (status === 'open') return <span className="pill pill-ok">Open</span>;
  if (status === 'closed') return <span className="pill pill-plain">Closed</span>;
  return <span className="pill pill-neutral">Draft</span>;
}

export function CollabTests() {
  const { runId } = useParams<{ runId: string }>();
  return runId ? <RunPage runId={runId} /> : <RunsList />;
}

// -------------------------------------------------------------------- list

function RunsList() {
  const [runs, setRuns] = useState<RunListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [archived, setArchived] = useState(false);
  const [toast, say] = useToast();
  const navigate = useNavigate();

  const load = useCallback(() => {
    setError(null);
    api
      .get<{ runs: RunListItem[] }>(`/api/admin/collab-runs${archived ? '?archived=1' : ''}`)
      .then((r) => setRuns(r.runs))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Could not load the runs.'));
  }, [archived]);

  useEffect(load, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <>
      <Head title="Collaboration Tests" sub="One organisation, diagnosed at one point in time" />

      <section className="card">
        <CardHead
          title="Runs"
          sub={runs === null ? undefined : `${runs.length} on the console`}
          aside={
            <span className="cd-actions">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                aria-pressed={archived}
                onClick={() => setArchived((v) => !v)}
              >
                {archived ? 'Active runs' : 'Archived'}
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating((v) => !v)}>
                New run
              </button>
            </span>
          }
        />
        {creating && <NewRun onCreated={(id) => navigate(`/admin/collaboration-tests/${id}`)} say={say} />}

        <DataTable
          rows={runs ?? []}
          rowKey={(r) => r.id}
          pageSize={25}
          minWidth={820}
          empty={
            <EmptyState
              title="No runs yet"
              body="A run asks a leadership group the 24 statements and reports on the organisation, not on the people in it."
            />
          }
          columns={[
            {
              key: 'name',
              header: 'Run',
              value: (r) => r.name,
              cell: (r) => (
                <button
                  type="button"
                  className="cd-linkish"
                  onClick={() => navigate(`/admin/collaboration-tests/${r.id}`)}
                >
                  {r.name}
                </button>
              ),
            },
            {
              key: 'organisation',
              header: 'Organisation',
              value: (r) => r.organisation,
              cell: (r) => r.organisation || <span className="muted">not recorded</span>,
            },
            {
              key: 'wave',
              header: 'Wave',
              value: (r) => r.round_label || `Wave ${r.round_no}`,
              cell: (r) => (
                <>
                  {r.round_label?.trim() || `Wave ${r.round_no}`}
                  {r.wave_count > 1 && <span className="muted"> of {r.wave_count}</span>}
                </>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              value: (r) => r.status,
              cell: (r) => <RunStatus status={r.status} />,
            },
            {
              key: 'answered',
              header: 'Answered',
              align: 'right',
              value: (r) => r.completed,
              cell: (r) => <span className="num">{r.completed}</span>,
            },
            {
              key: 'created',
              header: 'Created',
              value: (r) => r.created_at,
              cell: (r) => <span className="muted">{formatDate(r.created_at)}</span>,
            },
          ]}
        />
      </section>
      <Toast message={toast} />
    </>
  );
}

function NewRun({ onCreated, say }: { onCreated: (id: string) => void; say: (m: string) => void }) {
  const [name, setName] = useState('');
  const [organisation, setOrganisation] = useState('');
  const [anonymous, setAnonymous] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api.post<{ id: string }>('/api/admin/collab-runs', {
        name: name.trim(),
        organisation: organisation.trim(),
        anonymous,
      });
      say('Run created. Set it up, then open it.');
      onCreated(created.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the run.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card-body cd-newrun" onSubmit={submit}>
      <input
        className="control"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Run name, e.g. Acme Pharma leadership"
        required
      />
      <input
        className="control"
        value={organisation}
        onChange={(e) => setOrganisation(e.target.value)}
        placeholder="Organisation"
      />
      <label className="cd-inline hint">
        <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
        Anonymous
      </label>
      <button className="btn btn-primary btn-sm" type="submit" disabled={busy || name.trim() === ''}>
        {busy ? 'Creating…' : 'Create'}
      </button>
      {error ? <span className="cd-err">{error}</span> : null}
    </form>
  );
}

// --------------------------------------------------------------------- run

type Tab = 'results' | 'people' | 'setup';

function RunPage({ runId }: { runId: string }) {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wave, setWave] = useState<number | undefined>(undefined);
  const [link, setLink] = useState<string | null>(null);
  const [toast, say] = useToast();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  const tab = (params.get('tab') as Tab) || 'results';
  const setTab = (next: Tab) => {
    const q = new URLSearchParams(params);
    q.set('tab', next);
    q.delete('person');
    setParams(q, { replace: true });
  };

  const load = useCallback(() => {
    setError(null);
    api
      .get<RunDetail>(`/api/admin/collab-runs/${runId}`)
      .then(setDetail)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Could not load this run.'));
  }, [runId]);

  useEffect(load, [load]);

  async function patch(
    body: Record<string, unknown>,
    done: (r: { sheets?: { sent: number; skipped: string | null } | null }) => string,
  ) {
    try {
      say(done(await api.patchJson(`/api/admin/collab-runs/${runId}`, body)));
      load();
    } catch (err) {
      say(err instanceof ApiError ? err.message : 'Could not change the run.');
    }
  }

  async function startWave() {
    const label = window.prompt(
      'What is this wave called? For example, March 2027.\n\nThe current wave closes and keeps its results. On a named run, everyone invited to it is sent a fresh link.',
      '',
    );
    if (label === null) return;
    try {
      const started = await api.post<{ no: number; carried: number }>(
        `/api/admin/collab-runs/${runId}/waves`,
        { label },
      );
      say(
        started.carried > 0
          ? `Wave ${started.no} open, ${started.carried} people sent a link.`
          : `Wave ${started.no} open.`,
      );
      setWave(undefined);
      load();
    } catch (err) {
      say(err instanceof ApiError ? err.message : 'Could not start a wave.');
    }
  }

  async function issueLink() {
    try {
      const issued = await api.post<{ token: string }>(`/api/admin/collab-runs/${runId}/link`, {});
      setLink(`${window.location.origin}/t/${issued.token}`);
      say('Link issued. It is shown once.');
    } catch (err) {
      say(err instanceof ApiError ? err.message : 'Could not issue a link.');
    }
  }

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!detail) return <Loading label="Loading run…" />;

  const current = detail.waves.at(-1);
  const started = detail.turnout?.started ?? 0;
  const q = wave ? `?wave=${wave}` : '';

  return (
    <>
      <Head title={detail.run.name} />

      <div className="cd-runhead">
        <button type="button" className="cd-back" onClick={() => navigate('/admin/collaboration-tests')}>
          ← All runs
        </button>
        <div className="cd-runhead-main">
          <h2>
            {detail.run.name} <RunStatus status={detail.run.status} />
          </h2>
          <p className="hint">
            {detail.run.organisation || 'No organisation'} ·{' '}
            {detail.run.anonymous ? 'Anonymous' : 'Named'} ·{' '}
            {detail.run.min_segment <= 1
              ? 'every group reported'
              : `groups under ${detail.run.min_segment} not reported`}{' '}
            ·{' '}
            {detail.waves.length > 1 ? `${detail.waves.length} waves` : 'one wave'}
          </p>
        </div>
        <div className="cd-actions">
          {detail.run.status !== 'open' && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => patch({ status: 'open' }, () => 'Run opened.')}
            >
              Open
            </button>
          )}
          {detail.run.status === 'open' && (
            <>
              <button type="button" className="btn btn-secondary btn-sm" onClick={issueLink}>
                Shared link
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={startWave}>
                New wave
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() =>
                  patch({ status: 'closed' }, (r) =>
                    r.sheets?.sent
                      ? `Closed, and ${r.sheets.sent} people were sent their own answers.`
                      : `Closed. ${r.sheets?.skipped ?? 'No further responses are accepted.'}`,
                  )
                }
              >
                Close
              </button>
            </>
          )}
          <a className="btn btn-secondary btn-sm" href={`/api/admin/collab-runs/${runId}/pdf${q}`}>
            Report
          </a>
          <a className="btn btn-secondary btn-sm" href={`/api/admin/collab-runs/${runId}/xlsx${q}`}>
            Excel
          </a>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            title="Copy this run's setup for another organisation, without anybody's answers"
            onClick={async () => {
              const copyName = window.prompt('What is the new run called?', `${detail.run.name} (copy)`);
              if (copyName === null) return;
              try {
                const copy = await api.post<{ id: string }>(`/api/admin/collab-runs/${runId}/duplicate`, {
                  name: copyName,
                });
                navigate(`/admin/collaboration-tests/${copy.id}`);
              } catch (err) {
                say(err instanceof ApiError ? err.message : 'Could not duplicate.');
              }
            }}
          >
            Duplicate
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            title="Archive this run, or delete it if nobody has answered"
            onClick={async () => {
              if (!window.confirm('Remove this run from the list? Any answers are kept and it is archived.')) {
                return;
              }
              try {
                const gone = await api.del<{ archived: boolean; responses?: number }>(
                  `/api/admin/collab-runs/${runId}`,
                );
                say(
                  gone.archived
                    ? `Archived, with ${gone.responses} responses kept.`
                    : 'Deleted. It had no responses.',
                );
                navigate('/admin/collaboration-tests');
              } catch (err) {
                say(err instanceof ApiError ? err.message : 'Could not remove the run.');
              }
            }}
          >
            {(detail.turnout?.started ?? 0) > 0 ? 'Archive' : 'Delete'}
          </button>
          {detail.waves.length > 1 && (
            <select
              className="control control-sm"
              value={wave ?? current?.no ?? 1}
              onChange={(e) => setWave(Number(e.target.value))}
              aria-label="Wave"
            >
              {detail.waves.map((w) => (
                <option key={w.no} value={w.no}>
                  {w.label.trim() || `Wave ${w.no}`} · {w.completed}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {link && (
        <p className="hint cd-oneshot">
          Shown once: <code>{link}</code>
        </p>
      )}

      <nav className="cd-tabs" aria-label="Run sections">
        {(
          [
            ['results', 'Results'],
            ['people', detail.run.anonymous ? 'Responses' : 'Participants'],
            ['setup', 'Setup'],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className="cd-tab"
            aria-current={tab === key}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'results' && (
        <>
          <RunResults runId={runId} wave={wave} />
          <RunTrend runId={runId} />
        </>
      )}

      {tab === 'people' &&
        (detail.run.anonymous ? (
          <ResponsesPanel runId={runId} facetKeys={detail.facets.map((f) => f.key)} />
        ) : (
          <RosterPanel runId={runId} status={detail.run.status} say={say} onChanged={load} />
        ))}

      {tab === 'setup' && (
        <RunSetup
          runId={runId}
          facets={detail.facets}
          locked={started > 0}
          onChanged={load}
          say={say}
          settings={{
            status: detail.run.status,
            anonymous: detail.run.anonymous,
            anonymityEditable: detail.run.anonymityEditable,
            shareSheets: detail.run.shareSheets,
            openQuestion: detail.run.openQuestion,
            reminderDays: detail.run.reminderDays ?? [],
            closesAt: detail.run.closesAt,
            benchmarkOptIn: detail.run.benchmarkOptIn,
            minSegment: detail.run.min_segment,
          }}
        />
      )}

      <Toast message={toast} />
    </>
  );
}
