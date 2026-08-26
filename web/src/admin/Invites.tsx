/**
 * Invites: one at a time, or a CSV batch that is validated before anything is
 * written, then queued and sent under the daily cap with a live progress read
 * and a retry for the failures.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../lib/api.js';
import {
  DataTable,
  CardHead,
  EmptyState,
  ErrorState,
  Head,
  Loading,
  Toast,
  copyToClipboard,
  formatDateTime,
  useToast,
} from './ui.js';

interface Assessment {
  id: string;
  name: string;
  status: string;
}

interface PreviewItem {
  row: number;
  firstName: string;
  lastName: string;
  email: string;
  organisation: string;
  valid: boolean;
  issue: string | null;
  known: boolean;
}

interface Preview {
  items: PreviewItem[];
  validCount: number;
  invalidCount: number;
  dailySendCap: number;
  sendsToday: number;
}

interface Batch {
  id: string;
  total: number;
  sent: number;
  failed: number;
  status: string;
}

interface BatchItem {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  status: string;
  error: string | null;
}

interface OutboxMessage {
  id: string;
  to_email: string;
  subject: string;
  kind: string;
  status: string;
  error: string | null;
  created_at: string;
  sent_at: string | null;
}

export function Invites() {
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [assessmentId, setAssessmentId] = useState('');
  const [toast, showToast] = useToast();
  // Bumped after anything that sends mail, so the outbox below reflects the
  // send that just happened instead of waiting for a page reload.
  const [mailSentAt, setMailSentAt] = useState(0);
  const onMailSent = useCallback(() => setMailSentAt((n) => n + 1), []);

  useEffect(() => {
    api
      .get<{ assessments: Assessment[] }>('/api/admin/assessments')
      .then((r) => {
        setAssessments(r.assessments);
        const live = r.assessments.find((a) => a.status === 'live');
        if (live) setAssessmentId(live.id);
      })
      .catch(() => setAssessments([]));
  }, []);

  return (
    <>
      <Head title="Invites" sub="Send one invitation, or upload a list." />

      <div className="stack-gap">
        <SingleInvite
          assessments={assessments}
          assessmentId={assessmentId}
          onAssessment={setAssessmentId}
          onToast={showToast}
          onMailSent={onMailSent}
        />
        <BulkInvite assessmentId={assessmentId} onToast={showToast} onMailSent={onMailSent} />
        <MailSettings onToast={showToast} />
        <Outbox refreshKey={mailSentAt} />
      </div>

      <Toast message={toast} />
    </>
  );
}

// ------------------------------------------------------------------- single

function SingleInvite({
  assessments,
  assessmentId,
  onAssessment,
  onToast,
  onMailSent,
}: {
  assessments: Assessment[];
  assessmentId: string;
  onAssessment: (id: string) => void;
  onToast: (msg: string) => void;
  onMailSent: () => void;
}) {
  const firstRef = useRef<HTMLInputElement>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [organisation, setOrganisation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent, send: boolean): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ url: string; sent: boolean; status?: string; error?: string | null }>(
        '/api/admin/invites/single',
        { assessmentId, firstName, lastName, email, organisation, send },
      );
      if (send) {
        // A refused send comes back 200 with `status: 'failed'` — the link was
        // still created, so the request did not fail. Reporting it as sent is
        // how an administrator ends up waiting on an email that never left.
        if (res.status === 'failed') {
          setError(`The invitation link was created, but the email was not sent: ${res.error ?? 'unknown error'}`);
          onMailSent();
          return;
        }
        onToast(
          res.status === 'logged'
            ? 'No mail provider configured — the invitation is in the outbox'
            : `Invitation sent to ${email}`,
        );
      } else {
        const copied = await copyToClipboard(res.url);
        onToast(copied ? 'Personal link copied to the clipboard' : res.url);
      }
      // Identity fields clear, organisation and assessment stay. Inviting a
      // cohort means repeating the company and the instrument while the person
      // changes every time — and keeping an email that was just invited is how
      // the same person gets invited twice by a stray second submit.
      setFirstName('');
      setLastName('');
      setEmail('');
      firstRef.current?.focus();
      if (send) onMailSent();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the invitation');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <CardHead title="Invite one person" sub="Creates a personal link and emails it" />
      <form className="card-body" onSubmit={(e) => submit(e, true)}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="inv-first">First name</label>
            <input
              id="inv-first"
              ref={firstRef}
              className="control"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="inv-last">Last name</label>
            <input
              id="inv-last"
              className="control"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="inv-email">
              Email address<span className="req">*</span>
            </label>
            <input
              id="inv-email"
              type="email"
              className="control"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="inv-org">Organisation</label>
            <input
              id="inv-org"
              className="control"
              value={organisation}
              onChange={(e) => setOrganisation(e.target.value)}
            />
          </div>
          <div className="field field-full">
            <label htmlFor="inv-assessment">Assessment</label>
            <select
              id="inv-assessment"
              className="control"
              value={assessmentId}
              onChange={(e) => onAssessment(e.target.value)}
            >
              {assessments.length === 0 ? <option value="">No assessment available yet</option> : null}
              {assessments.map((a) => (
                <option key={a.id} value={a.id} disabled={a.status !== 'live'}>
                  {a.name}
                  {a.status !== 'live' ? ` — ${a.status}` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error ? (
          <div className="banner is-shown mt-4" role="alert">
            <span>{error}</span>
          </div>
        ) : null}

        <div className="form-foot">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={(e) => submit(e, false)}>
            Create link only
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !assessmentId}>
            {busy ? 'Working…' : 'Send invitation'}
          </button>
        </div>
      </form>
    </section>
  );
}

// --------------------------------------------------------------------- bulk

function BulkInvite({
  assessmentId,
  onToast,
  onMailSent,
}: {
  assessmentId: string;
  onToast: (msg: string) => void;
  onMailSent: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [batch, setBatch] = useState<{ batch: Batch; items: BatchItem[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const csv = await file.text();
      setPreview(await api.post<Preview>('/api/admin/invites/bulk/preview', { csv }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not read that file');
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  async function confirm(): Promise<void> {
    if (!preview) return;
    setBusy(true);
    try {
      const rows = preview.items
        .filter((i) => i.valid)
        .map(({ firstName, lastName, email, organisation }) => ({
          firstName,
          lastName,
          email,
          organisation,
        }));
      const res = await api.post<{ batchId: string; queued: number }>('/api/admin/invites/bulk/confirm', {
        assessmentId,
        rows,
      });
      setBatchId(res.batchId);
      setPreview(null);
      if (fileRef.current) fileRef.current.value = '';
      onToast(`${res.queued} invitations queued`);
      onMailSent();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not queue the batch');
    } finally {
      setBusy(false);
    }
  }

  const poll = useCallback(async () => {
    if (!batchId) return;
    try {
      setBatch(await api.get<{ batch: Batch; items: BatchItem[] }>(`/api/admin/invites/bulk/${batchId}`));
    } catch {
      /* transient — the next tick will try again */
    }
  }, [batchId]);

  useEffect(() => {
    if (!batchId) return;
    void poll();
    // Stop once every item has settled — a finished batch never changes again.
    if (batch && batch.batch.sent + batch.batch.failed >= batch.batch.total) return;
    const t = setInterval(poll, 2000);
    return () => clearInterval(t);
  }, [batchId, poll, batch]);

  async function retry(): Promise<void> {
    if (!batchId) return;
    const res = await api.post<{ retried: number }>(`/api/admin/invites/bulk/${batchId}/retry`);
    onToast(res.retried ? `Retrying ${res.retried} failed invitations` : 'Nothing to retry');
    void poll();
  }

  const failures = batch?.items.filter((i) => i.status === 'failed') ?? [];

  return (
    <section className="card">
      <CardHead
        title="Invite in bulk"
        sub="CSV with an email column; first name, last name and organisation are optional"
      />

      <div className="card-body">
        {!preview && !batchId ? (
          <div className="file-drop">
            <b>No list uploaded yet</b>
            <span>Upload a CSV and every row is validated before a single message is sent.</span>
            <label className="file-pick">
              <span className="btn btn-secondary btn-sm">{busy ? 'Reading…' : 'Choose a CSV file'}</span>
              <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} disabled={busy} />
            </label>
          </div>
        ) : null}

        {error ? (
          <div className="banner is-shown" role="alert">
            <span>{error}</span>
          </div>
        ) : null}

        {preview ? (
          <>
            <div className="toolbar-row mb-3">
              <span className="pill pill-ok">{preview.validCount} will be invited</span>
              {preview.invalidCount > 0 ? (
                <span className="pill pill-warn">{preview.invalidCount} skipped</span>
              ) : null}
              <span className="inline-note">
                {preview.sendsToday} of {preview.dailySendCap} sends used today
              </span>
            </div>

            {preview.validCount > preview.dailySendCap - preview.sendsToday ? (
              <div className="banner is-shown">
                <span>
                  This batch is larger than today’s remaining allowance. The excess will be marked failed and
                  can be retried tomorrow, or raise the cap below.
                </span>
              </div>
            ) : null}

            {preview.items.length === 0 ? (
              <EmptyState
                title="That file has no rows"
                body="The CSV parsed cleanly but contained no data rows. Check it has a header line and at least one email."
                action={{
                  label: 'Choose another file',
                  onClick: () => {
                    setPreview(null);
                    if (fileRef.current) fileRef.current.value = '';
                  },
                }}
              />
            ) : (
              <div className="table-scroll capped">
                <table className="table-preview">
                  <thead>
                    <tr>
                      <th className="right">Row</th>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Organisation</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.items.map((i) => (
                      <tr key={i.row}>
                        <td className="right num">{i.row}</td>
                        <td className="name">
                          {`${i.firstName} ${i.lastName}`.trim() || <span className="muted">—</span>}
                        </td>
                        <td>{i.email || <em className="muted">missing</em>}</td>
                        <td className="cell-truncate">{i.organisation || <span className="muted">—</span>}</td>
                        <td>
                          {i.valid ? (
                            <span className="pill pill-ok">
                              {i.known ? 'Known — will resend' : 'Will invite'}
                            </span>
                          ) : (
                            <span className="pill pill-warn">{i.issue}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="form-foot">
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setPreview(null);
                  if (fileRef.current) fileRef.current.value = '';
                }}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={confirm}
                disabled={busy || preview.validCount === 0 || !assessmentId}
              >
                Send {preview.validCount} invitations
              </button>
            </div>
          </>
        ) : null}

        {batch ? (
          <>
            <div className="toolbar-row mb-3" role="status" aria-live="polite">
              <span className="pill pill-ok">{batch.batch.sent} sent</span>
              {batch.batch.failed > 0 ? (
                <span className="pill pill-warn">{batch.batch.failed} failed</span>
              ) : null}
              <span className="inline-note">of {batch.batch.total} queued</span>
            </div>
            <div
              className="progress-strip"
              role="progressbar"
              aria-label="Batch progress"
              aria-valuenow={batch.batch.sent + batch.batch.failed}
              aria-valuemin={0}
              aria-valuemax={batch.batch.total}
            >
              <i
                style={{
                  transform: `scaleX(${(batch.batch.sent + batch.batch.failed) / Math.max(batch.batch.total, 1)})`,
                }}
              />
            </div>

            {failures.length > 0 ? (
              <>
                <p className="group-label mt-6">Failures</p>
                <div className="table-scroll capped">
                  <table>
                    <thead>
                      <tr>
                        <th>Email</th>
                        <th>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {failures.map((f) => (
                        <tr key={f.id}>
                          <td className="name">{f.email}</td>
                          <td>{f.error}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="form-foot">
                  <span className="inline-note">Retrying re-queues only the failures.</span>
                  <button className="btn btn-secondary" onClick={retry}>
                    Retry {failures.length} failed
                  </button>
                </div>
              </>
            ) : null}

            <div className="form-foot">
              <span className="inline-note">Batch {batch.batch.status}</span>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setBatchId(null);
                  setBatch(null);
                }}
              >
                Start another batch
              </button>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

// ----------------------------------------------------------- mail settings

function MailSettings({ onToast }: { onToast: (msg: string) => void }) {
  const [cap, setCap] = useState(50);
  const [attach, setAttach] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<{ mail: { dailySendCap: number; attachPdf: boolean } }>('/api/admin/branding')
      .then((r) => {
        setCap(r.mail.dailySendCap);
        setAttach(r.mail.attachPdf);
      })
      .catch(() => undefined);
  }, []);

  async function save(): Promise<void> {
    setBusy(true);
    try {
      await api.put('/api/admin/settings/mail', { dailySendCap: cap, attachPdf: attach });
      onToast('Mail settings saved');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <CardHead title="Sending" sub="Applies to invitations across every assessment" />
      <div className="card-body">
        <div className="wl-row">
          <div className="wl-key">
            <b>
              <label htmlFor="mail-cap">Daily send cap</label>
            </b>
            <span>Invitations per UTC day</span>
          </div>
          <div className="wl-val">
            <input
              id="mail-cap"
              className="control control-num"
              type="number"
              min={1}
              max={10000}
              value={cap}
              onChange={(e) => setCap(Number(e.target.value))}
            />
          </div>
        </div>
        <div className="wl-row">
          <div className="wl-key">
            <b>Attach the PDF</b>
            <span>Report emails carry the PDF as well as the link</span>
          </div>
          <div className="wl-val">
            <label className="check-label">
              <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} />
              Attach the report PDF
            </label>
          </div>
        </div>
        <div className="form-foot">
          <span className="inline-note">Reports are always available at the emailed link.</span>
          <button className="btn btn-primary" type="button" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save sending settings'}
          </button>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------- outbox

/** Stored enum values are lower_snake; the console shows prose. */
function sentenceCase(value: string): string {
  const words = value.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Several actions report "the message is in the outbox". Without this card
 * that sentence names a place the operator cannot reach.
 */
function Outbox({ refreshKey }: { refreshKey: number }) {
  const [messages, setMessages] = useState<OutboxMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api
      .get<{ messages: OutboxMessage[] }>('/api/admin/outbox')
      .then((r) => setMessages(r.messages))
      .catch((e: Error) => setError(e.message));
  }, []);

  // `refreshKey` changes whenever something on this page sends mail, so a send
  // and the row proving it happened no longer need a page reload between them.
  useEffect(load, [load, refreshKey]);

  return (
    <section className="card">
      <CardHead
        title="Outbox"
        sub="The last 100 messages the platform tried to send"
        aside={
          <button className="btn btn-secondary btn-sm" type="button" onClick={load}>
            Refresh
          </button>
        }
      />
      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : !messages ? (
        <Loading label="Loading the outbox…" />
      ) : messages.length === 0 ? (
        <EmptyState
          title="Nothing has been sent yet"
          body="Every invitation and report email is recorded here with its result, so a failed send is never silent."
        />
      ) : (
        <DataTable
          rows={messages}
          rowKey={(m) => String(m.id)}
          pageSize={25}
          minWidth={880}
          className="table-outbox"
          columns={[
            {
              key: 'to',
              header: 'Recipient',
              className: 'name',
              value: (m) => m.to_email,
              cell: (m) => m.to_email,
            },
            {
              key: 'subject',
              header: 'Subject',
              className: 'cell-truncate',
              value: (m) => m.subject,
              cell: (m) => m.subject,
            },
            {
              key: 'kind',
              header: 'Kind',
              width: '130px',
              value: (m) => m.kind,
              cell: (m) => sentenceCase(m.kind),
            },
            {
              key: 'status',
              header: 'Status',
              width: '160px',
              value: (m) => m.status,
              cell: (m) => (
                <>
                  <span
                    className={`pill ${
                      m.status === 'sent'
                        ? 'pill-ok'
                        : m.status === 'failed'
                          ? 'pill-warn'
                          : 'pill-neutral'
                    }`}
                  >
                    {sentenceCase(m.status)}
                  </span>
                  {m.error ? <span className="cell-sub danger">{m.error}</span> : null}
                </>
              ),
            },
            {
              key: 'created',
              header: 'Created',
              width: '150px',
              align: 'right',
              className: 'num',
              value: (m) => m.created_at,
              cell: (m) => formatDateTime(m.created_at),
            },
          ]}
        />
      )}
    </section>
  );
}
