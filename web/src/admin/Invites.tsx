/**
 * Invites: one at a time, or a CSV batch that is validated before anything is
 * written, then queued and sent under the daily cap with a live progress read
 * and a retry for the failures.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../lib/api.js';
import { Head, Toast, copyToClipboard, useToast } from './ui.js';

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

export function Invites() {
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [assessmentId, setAssessmentId] = useState('');
  const [toast, showToast] = useToast();

  useEffect(() => {
    api.get<{ assessments: Assessment[] }>('/api/admin/assessments').then((r) => {
      setAssessments(r.assessments);
      const live = r.assessments.find((a) => a.status === 'live');
      if (live) setAssessmentId(live.id);
    });
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
        />
        <BulkInvite assessmentId={assessmentId} onToast={showToast} />
        <MailSettings onToast={showToast} />
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
}: {
  assessments: Assessment[];
  assessmentId: string;
  onAssessment: (id: string) => void;
  onToast: (msg: string) => void;
}) {
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
      const res = await api.post<{ url: string; sent: boolean; status?: string }>(
        '/api/admin/invites/single',
        { assessmentId, firstName, lastName, email, organisation, send },
      );
      if (send) {
        onToast(
          res.status === 'logged'
            ? 'No mail provider configured — the invitation is in the outbox'
            : `Invitation sent to ${email}`,
        );
      } else {
        const copied = await copyToClipboard(res.url);
        onToast(copied ? 'Personal link copied to the clipboard' : res.url);
      }
      setFirstName('');
      setLastName('');
      setEmail('');
      setOrganisation('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the invitation');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Invite one person</div>
          <div className="card-sub">Creates a personal link and emails it</div>
        </div>
      </div>
      <form className="card-body" onSubmit={(e) => submit(e, true)}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="inv-first">First name</label>
            <input
              id="inv-first"
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
          <div className="banner is-shown" style={{ marginTop: 16 }} role="alert">
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

function BulkInvite({ assessmentId, onToast }: { assessmentId: string; onToast: (msg: string) => void }) {
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
    const t = setInterval(poll, 2000);
    return () => clearInterval(t);
  }, [batchId, poll]);

  useEffect(() => {
    if (batch && batch.batch.sent + batch.batch.failed >= batch.batch.total) {
      // Batch finished — one more read settles the final list, then stop.
    }
  }, [batch]);

  async function retry(): Promise<void> {
    if (!batchId) return;
    const res = await api.post<{ retried: number }>(`/api/admin/invites/bulk/${batchId}/retry`);
    onToast(res.retried ? `Retrying ${res.retried} failed invitations` : 'Nothing to retry');
    void poll();
  }

  const failures = batch?.items.filter((i) => i.status === 'failed') ?? [];

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Invite in bulk</div>
          <div className="card-sub">
            CSV with an <code>email</code> column; first name, last name and organisation are optional
          </div>
        </div>
      </div>

      <div className="card-body">
        {!preview && !batchId ? (
          <div className="file-drop">
            Upload a CSV to check it before anything is sent.
            <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} disabled={busy} />
          </div>
        ) : null}

        {error ? (
          <div className="banner is-shown" role="alert">
            <span>{error}</span>
          </div>
        ) : null}

        {preview ? (
          <>
            <div className="toolbar-row" style={{ marginBottom: 12 }}>
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

            <div className="table-scroll capped">
              <table>
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
                        {i.firstName} {i.lastName}
                      </td>
                      <td>{i.email || <em className="muted">missing</em>}</td>
                      <td>{i.organisation || '—'}</td>
                      <td>
                        {i.valid ? (
                          <span className="pill pill-ok">{i.known ? 'Known — will resend' : 'Will invite'}</span>
                        ) : (
                          <span className="pill pill-warn">{i.issue}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

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
            <div className="toolbar-row" style={{ marginBottom: 10 }}>
              <span className="pill pill-ok">{batch.batch.sent} sent</span>
              {batch.batch.failed > 0 ? (
                <span className="pill pill-warn">{batch.batch.failed} failed</span>
              ) : null}
              <span className="inline-note">of {batch.batch.total} queued</span>
            </div>
            <div className="progress-strip">
              <i
                style={{
                  width: `${((batch.batch.sent + batch.batch.failed) / Math.max(batch.batch.total, 1)) * 100}%`,
                }}
              />
            </div>

            {failures.length > 0 ? (
              <>
                <p className="side-label" style={{ padding: 0, marginTop: 20 }}>
                  Failures
                </p>
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
      <div className="card-head">
        <div>
          <div className="card-title">Sending</div>
          <div className="card-sub">Applies to invitations across every assessment</div>
        </div>
      </div>
      <div className="card-body">
        <div className="wl-row">
          <div className="wl-key">
            <b>Daily send cap</b>
            <span>Invitations per UTC day</span>
          </div>
          <div className="wl-val">
            <input
              className="control"
              type="number"
              min={1}
              max={10000}
              style={{ width: 120 }}
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
            <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 13.5 }}>
              <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} />
              Attach the report PDF
            </label>
          </div>
        </div>
        <div className="form-foot">
          <span className="inline-note">Reports are always available at the emailed link.</span>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save sending settings'}
          </button>
        </div>
      </div>
    </section>
  );
}
