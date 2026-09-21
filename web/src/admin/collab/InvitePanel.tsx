/**
 * Who has been invited to a named run, and where each of them got to.
 *
 * Shown only for a named run. An anonymous run cannot post a personal link to
 * a named person without tying their answers back to them, so the server
 * refuses it and this panel is never drawn — an action that exists and always
 * fails teaches a facilitator to distrust the console.
 *
 * The list says who has finished, not what anybody answered. Those are
 * different facts, and only the first one is any of the facilitator's business
 * while the run is open.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../../lib/api.js';
import { CardHead, formatDate } from '../ui.js';
import { PersonAnswers } from './PersonAnswers.js';

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
  if (p.status === 'in_progress') return { label: `${p.answered} of 24`, className: 'pill pill-warn' };
  if (p.openedAt) return { label: 'Opened', className: 'pill pill-neutral' };
  return { label: 'Not opened', className: 'pill pill-plain' };
}

export function InvitePanel({
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
  /*
   * Whose answers are open lives in the URL. A facilitator reading one
   * person's sheet during a debrief wants that view to survive a refresh, and
   * to be the thing they can send to a colleague who is also in the room.
   */
  const [params, setParams] = useSearchParams();
  const open = params.get('person');
  const setOpen = (linkId: string | null) => {
    const next = new URLSearchParams(params);
    if (linkId) next.set('person', linkId);
    else next.delete('person');
    setParams(next, { replace: true });
  };
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; department: string }>({ name: '', department: '' });
  const [addresses, setAddresses] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<{ participants: Participant[] }>(`/api/admin/collab-runs/${runId}/participants`)
      .then((r) => setPeople(r.participants))
      .catch(() => setPeople([]));
  }, [runId]);

  useEffect(load, [load]);

  /*
   * One person per line: an address on its own, or "Name, email, Department".
   * Facilitators arrive with a spreadsheet column, and retyping it into three
   * separate boxes fifty times is the kind of friction that ends with the
   * whole thing being done by hand outside the tool.
   */
  const people_in = addresses
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const parts = line.split(/[,;\t]+/).map((p) => p.trim());
      const email = parts.find((p) => p.includes('@')) ?? '';
      const rest = parts.filter((p) => p !== email && p !== '');
      return { email, name: rest[0] ?? '', department: rest[1] ?? '' };
    })
    .filter((p) => p.email !== '');

  async function run<T>(work: () => Promise<T>, done: (result: T) => string): Promise<void> {
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

  const invite = () =>
    run(
      () =>
        api.post<{ sent: number; skipped: number }>(`/api/admin/collab-runs/${runId}/invites`, {
          people: people_in,
        }),
      (r) => {
        setAddresses('');
        return r.skipped > 0
          ? `${r.sent} invited. ${r.skipped} already held a working link and were left alone.`
          : `${r.sent} invited.`;
      },
    );

  const remind = () =>
    run(
      () => api.post<{ reminded: number; message?: string }>(`/api/admin/collab-runs/${runId}/remind`, {}),
      (r) => r.message ?? `${r.reminded} reminded.`,
    );

  const resend = (p: Participant) =>
    run(
      () => api.post<{ email: string }>(`/api/admin/collab-runs/${runId}/participants/${p.linkId}/resend`, {}),
      (r) => `A fresh link is on its way to ${r.email}.`,
    );

  const save = (p: Participant) =>
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
    );

  const remove = (p: Participant) =>
    run(
      () => api.del<{ keptAnswers: boolean }>(`/api/admin/collab-runs/${runId}/participants/${p.linkId}`),
      (r) =>
        r.keptAnswers
          ? `${p.email} removed. Their link no longer works, and the answers they already gave stay in the results.`
          : `${p.email} removed.`,
    );

  const finished = people?.filter((p) => p.status === 'completed').length ?? 0;

  return (
    <section className="card mt-5">
      <CardHead
        title="Participants"
        sub={
          people === null
            ? 'Each person gets their own link.'
            : people.length === 0
              ? 'Nobody invited yet. Each person gets their own link.'
              : `${finished} of ${people.length} have finished. A reminder re-opens the same half-finished sheet rather than starting a new one.`
        }
      />

      {people && people.length > 0 && (
        <div className="cd-people">
          {people.map((p) => {
            const state = stateOf(p);
            return (
              <div key={p.linkId}>
                <div className="cd-person">
                  {editing === p.linkId ? (
                    <span className="cd-person-edit">
                      <input
                        className="control"
                        value={draft.name}
                        placeholder="Name"
                        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      />
                      <input
                        className="control"
                        value={draft.department}
                        placeholder="Department"
                        onChange={(e) => setDraft({ ...draft, department: e.target.value })}
                      />
                      <span className="hint">{p.email}</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="cd-person-email cd-person-open"
                      onClick={() => setOpen(open === p.linkId ? null : p.linkId)}
                      title={
                        p.status === 'completed'
                          ? 'See what they answered'
                          : 'They have not finished yet'
                      }
                    >
                      {p.name || p.email}
                      <em>
                        {p.department ? `${p.department} · ` : ''}
                        {p.name ? `${p.email} · ` : ''}
                        invited {formatDate(p.invitedAt)}
                      </em>
                    </button>
                  )}
                  <span className={state.className}>{state.label}</span>
                  <span className="cd-person-actions">
                    {editing === p.linkId ? (
                      <>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => save(p)}
                          disabled={busy}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => setEditing(null)}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            setEditing(p.linkId);
                            setDraft({ name: p.name, department: p.department });
                          }}
                          disabled={busy}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => resend(p)}
                          disabled={busy || p.status === 'completed'}
                          title={
                            p.status === 'completed'
                              ? 'They have already finished'
                              : 'Send this person their link again'
                          }
                        >
                          Resend
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => remove(p)}
                          disabled={busy}
                          title="Stop their link working. Answers they have already given stay in the results."
                        >
                          Remove
                        </button>
                      </>
                    )}
                  </span>
                </div>
                {open === p.linkId && <PersonAnswers runId={runId} linkId={p.linkId} />}
              </div>
            );
          })}
        </div>
      )}

      <div className="card-body">
        <div className="cd-invite-grid">
          <textarea
            className="control"
            rows={3}
            value={addresses}
            placeholder={
              'One person per line. An address is enough, or add a name and department:\n' +
              'Anita Rao, anita@acmepharma.com, Operations\n' +
              'joseph@acmepharma.com'
            }
            onChange={(e) => setAddresses(e.target.value)}
          />
          <div className="cd-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={invite}
              disabled={busy || people_in.length === 0 || status !== 'open'}
            >
              {busy ? 'Working…' : people_in.length > 0 ? `Invite ${people_in.length}` : 'Invite'}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={remind}
              disabled={busy || (people?.length ?? 0) === 0}
            >
              Remind whoever has not finished
            </button>
          </div>
          {status !== 'open' && (
            <p className="hint">Open the run before inviting anyone: a link into a closed run does not work.</p>
          )}
        </div>
      </div>

      {error ? (
        <div className="banner is-shown" role="alert">
          {error}
        </div>
      ) : null}
    </section>
  );
}
