/**
 * Collaboration Tests: the runs a facilitator has set up, and one run's results.
 *
 * A run is one organisation diagnosed at one point in time. Two runs never pool
 * into one average, and a wave is the same organisation asked again later, so
 * the list is a list of *runs* and the wave is chosen inside one.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../../lib/api.js';
import { CardHead, EmptyState, ErrorState, Head, Loading, formatDate, Toast, useToast } from '../ui.js';
import { RunResults } from './RunResults.js';
import { FacetEditor } from './FacetEditor.js';
import { RunTrend } from './RunTrend.js';
import { InvitePanel } from './InvitePanel.js';
import type { RunListItem } from './types.js';

interface RunDetail {
  run: {
    id: string;
    name: string;
    organisation: string;
    status: 'draft' | 'open' | 'closed';
    min_segment: number;
    anonymous: boolean;
    shareSheets: boolean;
    otpRequired: boolean;
    linkOnlyIdentity: boolean;
  };
  waves: { no: number; label: string; opened_at: string; closed_at: string | null; completed: number }[];
  facets: { key: string; label: string; options: string[]; required: boolean }[];
  turnout: { invited: number; started: number; completed: number } | null;
}

/**
 * A run is draft, open or closed. The console's StatusPill speaks about
 * responses — its fallback reads "Invited" — and a run that has taken 47
 * answers must never be labelled as though nobody had started.
 */
function RunStatus({ status }: { status: 'draft' | 'open' | 'closed' }) {
  if (status === 'open') return <span className="pill pill-ok">Open</span>;
  if (status === 'closed') return <span className="pill pill-plain">Closed</span>;
  return <span className="pill pill-neutral">Draft</span>;
}

export function CollabTests() {
  const [runs, setRuns] = useState<RunListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, say] = useToast();
  // The open run lives in the URL, not in component state: a facilitator
  // reading a wave wants to send that page to a colleague, and a results
  // screen you cannot link to is one a client has to be talked through.
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const openId = runId ?? null;

  const load = useCallback(() => {
    setError(null);
    api
      .get<{ runs: RunListItem[] }>('/api/admin/collab-runs')
      .then((r) => setRuns(r.runs))
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : 'Could not load the runs.'),
      );
  }, []);

  useEffect(load, [load]);

  if (openId) {
    return (
      <>
        <Head title="Collaboration Tests" />
        <button
          type="button"
          className="btn btn-secondary btn-sm mb-4"
          onClick={() => navigate('/admin/collaboration-tests')}
        >
          ← All runs
        </button>
        <RunDetailView runId={openId} onChanged={load} say={say} />
        <Toast message={toast} />
      </>
    );
  }

  return (
    <>
      <Head
        title="Collaboration Tests"
        sub="The Collaboration Diagnostic, run on one organisation at a time"
      />
      <NewRun
        onCreated={(id) => {
          load();
          navigate(`/admin/collaboration-tests/${id}`);
        }}
        say={say}
      />

      <section className="card mt-5">
        <CardHead title="Runs" sub="Each run is one organisation, diagnosed at one point in time." />
        {error ? (
          <ErrorState message={error} onRetry={load} />
        ) : !runs ? (
          <Loading label="Loading runs…" />
        ) : runs.length === 0 ? (
          <EmptyState
            title="No runs yet"
            body="A run collects the 24 statements from a leadership group and reports on the organisation, not on the people in it."
          />
        ) : (
          <div className="cd-runs">
            {runs.map((run) => (
              <button
                type="button"
                key={run.id}
                className="cd-run"
                onClick={() => navigate(`/admin/collaboration-tests/${run.id}`)}
              >
                <span>
                  <span className="cd-run-name">{run.name}</span>
                  <span className="cd-run-org">{run.organisation || 'No organisation recorded'}</span>
                </span>
                <span className="cd-run-wave">
                  {run.round_label?.trim() || `Wave ${run.round_no}`}
                  {run.wave_count > 1 && ` of ${run.wave_count}`}
                </span>
                <span>
                  <RunStatus status={run.status} />
                </span>
                <span className="cd-run-count num">
                  {run.completed} answered
                  <span className="cd-run-org">{formatDate(run.created_at)}</span>
                </span>
              </button>
            ))}
          </div>
        )}
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
      setName('');
      setOrganisation('');
      say('Run created. Choose how results break down, then open it.');
      onCreated(created.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the run.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <CardHead
        title="New run"
        sub="Name it after the group you are diagnosing. Everything else can be changed until people start answering."
      />
      <div className="card-body">
        <form className="cd-create" onSubmit={submit}>
          <input
            className="control"
            id="cd-new-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Run name, e.g. Acme Pharma leadership"
            required
          />
          <input
            className="control"
            id="cd-new-org"
            value={organisation}
            onChange={(e) => setOrganisation(e.target.value)}
            placeholder="Organisation"
          />
          <label className="cd-check" htmlFor="cd-new-anon">
            <input
              type="checkbox"
              id="cd-new-anon"
              checked={anonymous}
              onChange={(e) => setAnonymous(e.target.checked)}
            />
            <span>
              <b>Anonymous responses</b>
              <em>
                Answers are stored detached from the people who gave them. This cannot be changed once
                anyone has answered.
              </em>
            </span>
          </label>
          <button className="btn btn-primary" type="submit" disabled={busy || name.trim() === ''}>
            {busy ? 'Creating…' : 'Create run'}
          </button>
        </form>
      </div>
      {error ? <div className="banner is-shown" role="alert">{error}</div> : null}
    </section>
  );
}

function RunDetailView({
  runId,
  onChanged,
  say,
}: {
  runId: string;
  onChanged: () => void;
  say: (m: string) => void;
}) {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wave, setWave] = useState<number | undefined>(undefined);
  const [link, setLink] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api
      .get<RunDetail>(`/api/admin/collab-runs/${runId}`)
      .then(setDetail)
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : 'Could not load this run.'),
      );
  }, [runId]);

  useEffect(load, [load]);

  async function setStatus(status: 'open' | 'closed') {
    try {
      const result = await api.patchJson<{ sheets: { built: number; sent: number; skipped: string | null } | null }>(
        `/api/admin/collab-runs/${runId}`,
        { status },
      );
      if (status === 'open') say('Run opened.');
      else if (result.sheets?.sent) {
        say(`Run closed, and ${result.sheets.sent} people were sent their own answers.`);
      } else {
        say(`Run closed. ${result.sheets?.skipped ?? 'No further responses are accepted.'}`);
      }
      load();
      onChanged();
    } catch (err) {
      say(err instanceof ApiError ? err.message : 'Could not change the run.');
    }
  }

  async function startWave() {
    const label = window.prompt(
      'What is this wave called? For example, March 2027.\n\nThe current wave closes and keeps its results. On a named run, everyone invited to it is sent a fresh link for the new one.',
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
          ? `Wave ${started.no} open, and ${started.carried} people were sent a link for it.`
          : `Wave ${started.no} open. The previous one is closed and keeps its results.`,
      );
      setWave(undefined);
      load();
      onChanged();
    } catch (err) {
      say(err instanceof ApiError ? err.message : 'Could not start a wave.');
    }
  }

  async function issueLink() {
    try {
      const issued = await api.post<{ token: string }>(`/api/admin/collab-runs/${runId}/link`, {});
      setLink(`${window.location.origin}/t/${issued.token}`);
      say('Link issued. It is shown once and cannot be recovered later.');
    } catch (err) {
      say(err instanceof ApiError ? err.message : 'Could not issue a link.');
    }
  }

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!detail) return <Loading label="Loading run…" />;

  const current = detail.waves.at(-1);

  return (
    <>
      <section className="card mb-5">
        <CardHead
          title={detail.run.name}
          sub={detail.run.organisation}
          aside={<RunStatus status={detail.run.status} />}
        />
        <div className="card-body cd-actions">
          {detail.run.status !== 'open' && (
            <button className="btn btn-primary btn-sm" type="button" onClick={() => setStatus('open')}>
              Open the run
            </button>
          )}
          {detail.run.status === 'open' && (
            <>
              <button className="btn btn-secondary btn-sm" type="button" onClick={issueLink}>
                Issue shared link
              </button>
              <button className="btn btn-secondary btn-sm" type="button" onClick={startWave}>
                Start a new wave
              </button>
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => setStatus('closed')}>
                Close the run
              </button>
            </>
          )}
          {/* A plain link, not a fetch: the browser saves the file itself and
              the session cookie goes with it. */}
          <a
            className="btn btn-secondary btn-sm"
            href={`/api/admin/collab-runs/${runId}/pdf${wave ? `?wave=${wave}` : ''}`}
          >
            Download report
          </a>
          <a
            className="btn btn-secondary btn-sm"
            href={`/api/admin/collab-runs/${runId}/xlsx${wave ? `?wave=${wave}` : ''}`}
          >
            Download workbook
          </a>
          {detail.waves.length > 1 && (
            <label className="cd-inline">
              <span className="hint">Wave</span>
              <select
                className="control"
                id="cd-wave"
                value={wave ?? current?.no ?? 1}
                onChange={(e) => setWave(Number(e.target.value))}
              >
                {detail.waves.map((w) => (
                  <option key={w.no} value={w.no}>
                    {w.label.trim() || `Wave ${w.no}`} · {w.completed} answered
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {link && (
          <p className="hint mt-3">
            Shared link, shown once: <code>{link}</code>
          </p>
        )}

        <p className="hint card-body">
          {detail.run.anonymous ? 'Responses are anonymous.' : 'Responses are named.'} Departments with
          fewer than {detail.run.min_segment} respondents are not reported.
        </p>

        {!detail.run.anonymous && (
          <label className="cd-check card-body" htmlFor="cd-share">
            <input
              type="checkbox"
              id="cd-share"
              checked={detail.run.shareSheets}
              onChange={async (e) => {
                try {
                  await api.patchJson(`/api/admin/collab-runs/${runId}`, { shareSheets: e.target.checked });
                  load();
                } catch (err) {
                  say(err instanceof ApiError ? err.message : 'Could not change that.');
                }
              }}
            />
            <span>
              <b>Send each person their own answers when the wave closes</b>
              <em>
                A single page comparing what they said with what the group said. Not a score: the
                diagnostic measures the organisation, and the sheet says so. Nothing is sent until you
                close the wave, because until then there is no group to compare anyone with.
              </em>
            </span>
          </label>
        )}
      </section>

      <section className="card mb-5">
        <CardHead
          title="Break results down by"
          sub="One or two background questions, asked before the statements. People pick from your list rather than typing their own, so one department cannot arrive spelled three ways."
        />
        <FacetEditor
          runId={runId}
          facets={detail.facets}
          locked={(detail.turnout?.started ?? 0) > 0}
          onSaved={load}
          say={say}
        />
      </section>

      {!detail.run.anonymous && (
        <InvitePanel runId={runId} status={detail.run.status} say={say} onChanged={load} />
      )}

      <RunTrend runId={runId} />

      <RunResults runId={runId} wave={wave} />
    </>
  );
}
