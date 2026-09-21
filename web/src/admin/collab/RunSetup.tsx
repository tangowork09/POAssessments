/**
 * Everything about a run that is decided before it opens, and the two things
 * that happen after it without anybody pressing a button.
 *
 * A facilitator sets a wave up on Monday and the next three weeks happen
 * without them. The closing date and the reminder days are here because a
 * deadline nobody enforces is a deadline nobody meets, and a chase that
 * depends on somebody remembering on a Thursday afternoon does not happen.
 */

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api.js';
import { CardHead, Loading } from '../ui.js';
import { FacetEditor } from './FacetEditor.js';

interface Preview {
  intro: { title: string; lede: string; instructions: string[]; emphasis: string; confidentiality?: string };
  scale: { min: number; max: number; labels: string[] };
  anonymous: boolean;
  facets: { label: string; options: string[]; required: boolean }[];
  statements: { no: number; text: string }[];
  openQuestion: string;
}

export interface RunSettings {
  status: 'draft' | 'open' | 'closed';
  anonymous: boolean;
  shareSheets: boolean;
  openQuestion: string;
  reminderDays: number[];
  closesAt: string | null;
  benchmarkOptIn: boolean;
  minSegment: number;
}

const REMINDER_CHOICES = [
  { days: [] as number[], label: 'By hand' },
  { days: [3], label: 'Day 3' },
  { days: [3, 7], label: 'Days 3 and 7' },
  { days: [2, 5, 9], label: 'Days 2, 5 and 9' },
];

export function RunSetup({
  runId,
  settings,
  facets,
  locked,
  onChanged,
  say,
}: {
  runId: string;
  settings: RunSettings;
  facets: { key: string; label: string; options: string[]; required: boolean }[];
  locked: boolean;
  onChanged: () => void;
  say: (message: string) => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [question, setQuestion] = useState(settings.openQuestion);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const loadNotes = useCallback(() => {
    api
      .get<{ notes: Record<string, string> }>(`/api/admin/collab-runs/${runId}/notes`)
      .then((r) => setNotes(r.notes))
      .catch(() => setNotes({}));
  }, [runId]);

  useEffect(loadNotes, [loadNotes]);

  async function patch(body: Record<string, unknown>, message: string) {
    setBusy(true);
    try {
      await api.patchJson(`/api/admin/collab-runs/${runId}`, body);
      say(message);
      onChanged();
    } catch (err) {
      say(err instanceof ApiError ? err.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  }

  async function openPreview() {
    setShowPreview(true);
    if (preview) return;
    try {
      setPreview(await api.get<Preview>(`/api/admin/collab-runs/${runId}/preview`));
    } catch (err) {
      say(err instanceof ApiError ? err.message : 'Could not build the preview.');
    }
  }

  const reminderKey = JSON.stringify(settings.reminderDays ?? []);

  return (
    <>
      <section className="card">
        <CardHead
          title="Break results down by"
          sub="Background questions asked before the statements. People pick from your list, so one department cannot arrive spelled three ways."
        />
        <FacetEditor runId={runId} facets={facets} locked={locked} onSaved={onChanged} say={say} />
      </section>

      <section className="card mt-4">
        <CardHead
          title="While the wave is open"
          sub="Set these once. Neither needs anybody to be at their desk on the day."
        />
        <div className="card-body cd-settings">
          <label className="cd-setting">
            <span className="cd-setting-label">Closes itself on</span>
            <input
              type="date"
              className="control control-sm"
              value={settings.closesAt?.slice(0, 10) ?? ''}
              disabled={busy}
              onChange={(e) =>
                patch(
                  { closesAt: e.target.value },
                  e.target.value ? `Closes on ${e.target.value}.` : 'Closes by hand now.',
                )
              }
            />
            <em>
              The wave stops accepting answers and, if it shares them, everyone gets their own sheet.
              Leave blank to close it yourself.
            </em>
          </label>

          <label className="cd-setting">
            <span className="cd-setting-label">Report a group of at least</span>
            <select
              className="control control-sm"
              value={settings.minSegment}
              disabled={busy}
              onChange={(e) =>
                patch(
                  { minSegment: Number(e.target.value) },
                  Number(e.target.value) === 1
                    ? 'Every group is reported, however small.'
                    : `Groups under ${e.target.value} are left out of the breakdown.`,
                )
              }
            >
              <option value={1}>1 — report every group, however small</option>
              {[2, 3, 4, 5, 6, 8, 10].map((n) => (
                <option key={n} value={n}>
                  {n} people
                </option>
              ))}
            </select>
            <em>
              {settings.minSegment <= 1
                ? 'Every department appears in the breakdown, including one of four people or one of one. With a very small group, its average is close to quoting the people in it — respondents are told this before they answer.'
                : `A department with fewer than ${settings.minSegment} respondents is left out of the breakdown rather than reported, because at that size an average is close to a quotation.`}
            </em>
          </label>

          <label className="cd-setting">
            <span className="cd-setting-label">Chase whoever has not finished</span>
            <select
              className="control control-sm"
              value={reminderKey}
              disabled={busy || settings.anonymous}
              onChange={(e) =>
                patch({ reminderDays: JSON.parse(e.target.value) }, 'Reminder schedule saved.')
              }
            >
              {REMINDER_CHOICES.map((choice) => (
                <option key={JSON.stringify(choice.days)} value={JSON.stringify(choice.days)}>
                  {choice.label}
                </option>
              ))}
            </select>
            <em>
              {settings.anonymous
                ? 'An anonymous run cannot tell who has answered, so there is nobody to chase.'
                : 'Counted from the day each person was invited. A reminder re-opens their half-finished sheet.'}
            </em>
          </label>
        </div>
      </section>

      <section className="card mt-4">
        <CardHead title="One open question" sub="Optional, asked after the 24 statements." />
        <div className="card-body cd-settings">
          <input
            className="control"
            value={question}
            maxLength={240}
            placeholder="What is the single biggest barrier to working across departments here?"
            onChange={(e) => setQuestion(e.target.value)}
          />
          <div className="cd-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy || question === settings.openQuestion}
              onClick={() =>
                patch({ openQuestion: question.trim() }, question.trim() ? 'Question saved.' : 'Question removed.')
              }
            >
              Save
            </button>
            <span className="hint">
              Never scored and never part of a mean: the instrument has 24 statements and this is not a
              25th. The answers appear in the report as quotations.
            </span>
          </div>
        </div>
      </section>

      {!settings.anonymous && (
        <section className="card mt-4">
          <CardHead title="When the wave closes" />
          <label className="cd-check card-body" htmlFor="cd-share">
            <input
              type="checkbox"
              id="cd-share"
              checked={settings.shareSheets}
              disabled={busy}
              onChange={(e) => patch({ shareSheets: e.target.checked }, 'Saved.')}
            />
            <span>
              <b>Send each person their own answers</b>
              <em>
                One page comparing what they said with what the group said. Not a score. Nothing is sent
                until the wave closes, because until then there is no group to compare anyone with.
              </em>
            </span>
          </label>
        </section>
      )}

      <section className="card mt-4">
        <CardHead title="Comparing with other clients" />
        <label className="cd-check card-body" htmlFor="cd-bench">
          <input
            type="checkbox"
            id="cd-bench"
            checked={settings.benchmarkOptIn}
            disabled={busy}
            onChange={(e) => patch({ benchmarkOptIn: e.target.checked }, 'Saved.')}
          />
          <span>
            <b>Let this organisation&rsquo;s figures sit in the benchmark</b>
            <em>
              Their numbers become part of an anonymous median shown to other clients, and they can see
              that median themselves. No organisation is ever named, and nothing is shown at all until
              several have opted in. This is the client&rsquo;s decision to make, not ours.
            </em>
          </span>
        </label>
      </section>

      <section className="card mt-4">
        <CardHead
          title="Your read"
          sub="Printed in the report under each section. The numbers say what happened; this is where you say what it means."
        />
        <div className="card-body cd-settings">
          <textarea
            className="control"
            rows={3}
            placeholder="Opening note, printed before the figures"
            value={notes[''] ?? ''}
            onChange={(e) => setNotes({ ...notes, '': e.target.value })}
          />
          <div className="cd-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api.put(`/api/admin/collab-runs/${runId}/notes`, { notes });
                  say('Your read is saved and will print in the report.');
                } catch (err) {
                  say(err instanceof ApiError ? err.message : 'Could not save that.');
                } finally {
                  setBusy(false);
                }
              }}
            >
              Save note
            </button>
          </div>
        </div>
      </section>

      <section className="card mt-4">
        <CardHead
          title="Before you send it"
          sub="What a respondent sees, without issuing a link or starting a response."
          aside={
            <button type="button" className="btn btn-secondary btn-sm" onClick={openPreview}>
              Preview the questionnaire
            </button>
          }
        />
        {showPreview &&
          (preview ? (
            <div className="card-body cd-preview">
              <h4>{preview.intro.title}</h4>
              <p className="hint">{preview.intro.lede}</p>
              {preview.intro.confidentiality && <p className="hint">{preview.intro.confidentiality}</p>}
              <ul className="cd-preview-scale">
                {preview.scale.labels.map((label, i) => (
                  <li key={label}>
                    <b>{preview.scale.min + i}</b> {label}
                  </li>
                ))}
              </ul>
              {preview.facets.map((f) => (
                <p key={f.label} className="cd-preview-q">
                  <b>{f.label}</b> — {f.options.join(' · ')}
                  {f.required ? '' : ' (may be skipped)'}
                </p>
              ))}
              <ol className="cd-preview-list">
                {preview.statements.map((st) => (
                  <li key={st.no}>{st.text}</li>
                ))}
              </ol>
              {preview.openQuestion && (
                <p className="cd-preview-q">
                  <b>Open question</b> — {preview.openQuestion}
                </p>
              )}
              <p className="hint">
                No section headings and no direct or reverse marks, exactly as the master copy
                specifies: a respondent who can see what a statement measures answers it differently.
              </p>
            </div>
          ) : (
            <Loading label="Building the preview…" />
          ))}
      </section>
    </>
  );
}
