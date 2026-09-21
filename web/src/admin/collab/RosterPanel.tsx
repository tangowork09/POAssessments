/**
 * The people a named run is asking, as a table.
 *
 * On the console's own DataTable, so it filters per column, sorts and pages
 * like every other list here: with fifty leaders the question is never "show
 * me everyone", it is "who in Quality has not finished", and that is a filter
 * on two columns rather than a scroll.
 *
 * Opening a row shows what that person answered. It is the only place in the
 * diagnostic where an individual's answers are readable, it serves a named run
 * only — which is what those respondents agreed to — and every read is written
 * to the activity log.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../../lib/api.js';
import { CardHead, DataTable, EmptyState } from '../ui.js';
import { PersonAnswers } from './PersonAnswers.js';

interface RosterPerson {
  email: string;
  name: string;
  department: string;
}

interface Participant {
  linkId: string;
  email: string;
  name: string;
  department: string;
  invitedAt: string;
  openedAt: string | null;
  status: 'invited' | 'in_progress' | 'completed' | string;
  answered: number;
}

function stateOf(p: Participant): { label: string; className: string } {
  if (p.status === 'completed') return { label: 'Finished', className: 'pill pill-ok' };
  if (p.status === 'in_progress') return { label: `${p.answered}/24`, className: 'pill pill-warn' };
  if (p.openedAt) return { label: 'Opened', className: 'pill pill-neutral' };
  return { label: 'Not opened', className: 'pill pill-plain' };
}

export function RosterPanel({
  runId,
  status,
  say,
  onChanged,
}: {
  runId: string;
  status: 'draft' | 'open' | 'closed';
  say: (message: string) => void;
  onChanged: () => void;
}) {
  const [people, setPeople] = useState<Participant[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: '', department: '' });
  const [adding, setAdding] = useState(false);
  const [addresses, setAddresses] = useState('');
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const open = params.get('person');

  const setOpen = (linkId: string | null) => {
    const next = new URLSearchParams(params);
    if (linkId) next.set('person', linkId);
    else next.delete('person');
    setParams(next, { replace: true });
  };

  const load = useCallback(() => {
    api
      .get<{ participants: Participant[] }>(`/api/admin/collab-runs/${runId}/participants`)
      .then((r) => setPeople(r.participants))
      .catch(() => setPeople([]));
  }, [runId]);

  useEffect(load, [load]);

  /** One person per line: an address alone, or "Name, email, Department". */
  const parsed = addresses
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/[,;\t]+/).map((p) => p.trim());
      const email = parts.find((p) => p.includes('@')) ?? '';
      const rest = parts.filter((p) => p !== email && p !== '');
      return { email, name: rest[0] ?? '', department: rest[1] ?? '' };
    })
    .filter((p) => p.email !== '');

  async function run<T>(work: () => Promise<T>, done: (r: T) => string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      say(done(await work()));
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * A spreadsheet, read and shown before anybody is emailed.
   *
   * HR arrives with a column of fifty people. Pasting the wrong tab of the
   * wrong workbook should be discovered in this box, not in fifty inboxes, so
   * the file is parsed into the same text area the facilitator can edit.
   */
  async function readFile(file: File) {
    setReading(true);
    setError(null);
    try {
      const parsedFile = await api.postRaw<{ people: RosterPerson[]; skipped: number; sheet: string }>(
        `/api/admin/collab-runs/${runId}/roster/parse`,
        await file.arrayBuffer(),
      );
      setAddresses(
        parsedFile.people
          .map((p) => [p.name, p.email, p.department].filter(Boolean).join(', '))
          .join('\n'),
      );
      setAdding(true);
      say(
        parsedFile.skipped > 0
          ? `${parsedFile.people.length} people read from “${parsedFile.sheet}”. ${parsedFile.skipped} rows had no address and were left out — check the list before inviting.`
          : `${parsedFile.people.length} people read from “${parsedFile.sheet}”. Check the list, then invite.`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That file could not be read.');
    } finally {
      setReading(false);
    }
  }

  const invite = () =>
    run(
      () =>
        api.post<{ sent: number; skipped: number }>(`/api/admin/collab-runs/${runId}/invites`, {
          people: parsed,
        }),
      (r) => {
        setAddresses('');
        setAdding(false);
        return r.skipped > 0 ? `${r.sent} invited, ${r.skipped} already had a link.` : `${r.sent} invited.`;
      },
    );

  const finished = people?.filter((p) => p.status === 'completed').length ?? 0;
  const outstanding = (people?.length ?? 0) - finished;

  return (
    <section className="card">
      <CardHead
        title="Participants"
        sub={
          people && people.length > 0
            ? `${finished} of ${people.length} finished`
            : 'Each person gets their own link'
        }
        aside={
          <span className="cd-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() =>
                run(
                  () =>
                    api.post<{ reminded: number; message?: string }>(
                      `/api/admin/collab-runs/${runId}/remind`,
                      {},
                    ),
                  (r) => r.message ?? `${r.reminded} reminded.`,
                )
              }
              disabled={busy || outstanding === 0}
              title={outstanding === 0 ? 'Everyone has finished' : `Chase the ${outstanding} outstanding`}
            >
              Remind {outstanding > 0 ? outstanding : ''}
            </button>
            <a
              className="btn btn-secondary btn-sm"
              href={`/api/admin/collab-runs/${runId}/outstanding.csv`}
              title="Names and addresses of everyone who has not finished"
            >
              Outstanding CSV
            </a>
            <label
              className={`btn btn-secondary btn-sm${status !== 'open' ? ' is-disabled' : ''}`}
              title="Read a participant list out of a spreadsheet"
            >
              {reading ? 'Reading…' : 'Upload list'}
              <input
                type="file"
                accept=".xlsx"
                hidden
                disabled={status !== 'open' || reading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void readFile(file);
                }}
              />
            </label>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setAdding((v) => !v)}
              disabled={status !== 'open'}
              title={status !== 'open' ? 'Open the run first' : 'Add people'}
            >
              Add people
            </button>
          </span>
        }
      />

      {adding && (
        <div className="card-body cd-add">
          <textarea
            className="control"
            rows={3}
            value={addresses}
            placeholder={'Anita Rao, anita@acmepharma.com, Operations\njoseph@acmepharma.com'}
            onChange={(e) => setAddresses(e.target.value)}
          />
          <div className="cd-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={invite}
              disabled={busy || parsed.length === 0}
            >
              {busy ? 'Sending…' : `Invite ${parsed.length || ''}`.trim()}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <span className="hint">One per line. A name and department are optional.</span>
          </div>
        </div>
      )}

      <DataTable
        rows={people ?? []}
        rowKey={(p) => p.linkId}
        pageSize={25}
        minWidth={760}
        className="cd-roster"
        empty={
          <EmptyState
            title="Nobody invited yet"
            body="Add people above and each gets their own link. A department recorded here is not asked of them when they answer."
          />
        }
        expand={(p) =>
          open === p.linkId ? <PersonAnswers runId={runId} linkId={p.linkId} /> : null
        }
        columns={[
          {
            key: 'name',
            header: 'Name',
            value: (p) => p.name || p.email,
            cell: (p) =>
              editing === p.linkId ? (
                <input
                  className="control control-sm"
                  value={draft.name}
                  placeholder="Name"
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              ) : (
                <button
                  type="button"
                  className="cd-linkish"
                  onClick={() => setOpen(open === p.linkId ? null : p.linkId)}
                  title={p.status === 'completed' ? 'See what they answered' : 'Not finished yet'}
                >
                  {p.name || p.email}
                </button>
              ),
          },
          {
            key: 'department',
            header: 'Department',
            value: (p) => p.department,
            cell: (p) =>
              editing === p.linkId ? (
                <input
                  className="control control-sm"
                  value={draft.department}
                  placeholder="Department"
                  onChange={(e) => setDraft({ ...draft, department: e.target.value })}
                />
              ) : (
                <span className={p.department ? '' : 'muted'}>{p.department || 'not recorded'}</span>
              ),
          },
          { key: 'email', header: 'Email', value: (p) => p.email, cell: (p) => p.email },
          {
            key: 'status',
            header: 'Status',
            value: (p) => stateOf(p).label,
            cell: (p) => {
              const s = stateOf(p);
              return <span className={s.className}>{s.label}</span>;
            },
          },
          {
            key: 'actions',
            header: '',
            align: 'right',
            className: 'row-actions',
            cell: (p) =>
              editing === p.linkId ? (
                <span className="cd-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () =>
                          api.patchJson<{ appliesToAnswers: boolean }>(
                            `/api/admin/collab-runs/${runId}/participants/${p.linkId}`,
                            draft,
                          ),
                        (r) => {
                          setEditing(null);
                          return r.appliesToAnswers
                            ? 'Saved.'
                            : 'Saved. They have already answered, so their response keeps the department it was given under.';
                        },
                      )
                    }
                  >
                    Save
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </span>
              ) : (
                <span className="cd-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busy}
                    onClick={() => {
                      setEditing(p.linkId);
                      setDraft({ name: p.name, department: p.department });
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busy || p.status === 'completed'}
                    title={p.status === 'completed' ? 'Already finished' : 'Send their link again'}
                    onClick={() =>
                      run(
                        () =>
                          api.post<{ email: string }>(
                            `/api/admin/collab-runs/${runId}/participants/${p.linkId}/resend`,
                            {},
                          ),
                        (r) => `A fresh link is on its way to ${r.email}.`,
                      )
                    }
                  >
                    Resend
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busy}
                    title="Stop their link working. Answers they already gave stay in the results."
                    onClick={() =>
                      run(
                        () =>
                          api.del<{ keptAnswers: boolean }>(
                            `/api/admin/collab-runs/${runId}/participants/${p.linkId}`,
                          ),
                        (r) =>
                          r.keptAnswers
                            ? `${p.email} removed. Their answers stay in the results.`
                            : `${p.email} removed.`,
                      )
                    }
                  >
                    Remove
                  </button>
                </span>
              ),
          },
        ]}
      />

      {error ? (
        <div className="banner is-shown" role="alert">
          {error}
        </div>
      ) : null}
    </section>
  );
}
