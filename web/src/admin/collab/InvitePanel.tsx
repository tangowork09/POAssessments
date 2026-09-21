/**
 * Inviting a named run's leaders, and chasing the ones who have not finished.
 *
 * Shown only for a named run. An anonymous run cannot post a personal link to
 * a named person without tying their answers back to them, so the server
 * refuses it and the panel is not offered at all — an action that exists and
 * always fails teaches a facilitator to distrust the console.
 */

import { useState } from 'react';
import { api, ApiError } from '../../lib/api.js';
import { CardHead } from '../ui.js';

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
  const [addresses, setAddresses] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emails = addresses
    .split(/[\n,;]+/)
    .map((v) => v.trim())
    .filter((v) => v !== '');

  async function invite() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ sent: number; skipped: number }>(
        `/api/admin/collab-runs/${runId}/invites`,
        { emails },
      );
      setAddresses('');
      say(
        result.skipped > 0
          ? `${result.sent} invited. ${result.skipped} already held a link for this wave and were left alone.`
          : `${result.sent} invited.`,
      );
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the invitations.');
    } finally {
      setBusy(false);
    }
  }

  async function remind() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ reminded: number; message?: string }>(
        `/api/admin/collab-runs/${runId}/remind`,
        {},
      );
      say(result.message ?? `${result.reminded} reminded.`);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send reminders.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card mt-5">
      <CardHead
        title="Invite and chase"
        sub="Each person gets their own link. A reminder re-opens the same half-finished sheet rather than starting a new one."
      />
      <div className="card-body">
        <div className="cd-invite-grid">
          <textarea
            className="control"
            rows={4}
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
              {busy ? 'Sending…' : `Invite ${emails.length || ''}`.trim()}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={remind} disabled={busy}>
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
