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
import { api, ApiError } from '../../lib/api.js';
import { CardHead, formatDate } from '../ui.js';

interface Participant {
  linkId: string;
  email: string;
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

  const emails = addresses
    .split(/[\n,;]+/)
    .map((v) => v.trim())
    .filter((v) => v !== '');

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
      () => api.post<{ sent: number; skipped: number }>(`/api/admin/collab-runs/${runId}/invites`, { emails }),
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
              <div className="cd-person" key={p.linkId}>
                <span className="cd-person-email">
                  {p.email}
                  <em>invited {formatDate(p.invitedAt)}</em>
                </span>
                <span className={state.className}>{state.label}</span>
                <span className="cd-person-actions">
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
                </span>
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
            placeholder={'One address per line\nanita@acmepharma.com\njoseph@acmepharma.com'}
            onChange={(e) => setAddresses(e.target.value)}
          />
          <div className="cd-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={invite}
              disabled={busy || emails.length === 0 || status !== 'open'}
            >
              {busy ? 'Working…' : emails.length > 0 ? `Invite ${emails.length}` : 'Invite'}
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
