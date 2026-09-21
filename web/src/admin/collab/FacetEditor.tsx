/**
 * The background questions a run asks, declared before anyone is invited.
 *
 * Each one is a closed list on purpose. Free text arrives as "Ops", "ops" and
 * "Operations ", which is one department to the organisation and three to a
 * GROUP BY, and no cleaning afterwards recovers which leader meant which. So
 * the facilitator writes the list once and every respondent picks from it.
 *
 * The editor locks the moment anybody answers, and says so rather than failing
 * on save. A respondent picked from the list they were shown: renaming an
 * option afterwards rewrites what forty people said, and deleting one leaves
 * their answers pointing at a department that no longer exists.
 */

import { useState } from 'react';
import { api, ApiError } from '../../lib/api.js';

export interface FacetDraft {
  key: string;
  label: string;
  options: string[];
  required: boolean;
}

/** A label becomes a key once, at first typing, and then stops moving. */
function keyFor(label: string, taken: Set<string>): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/^[^a-z]+/, '') || 'cut';
  let key = base.slice(0, 32);
  let n = 2;
  while (taken.has(key)) key = `${base.slice(0, 28)}_${n++}`;
  return key;
}

export function FacetEditor({
  runId,
  facets,
  locked,
  onSaved,
  say,
}: {
  runId: string;
  facets: FacetDraft[];
  /** True once anyone has started answering. */
  locked: boolean;
  onSaved: () => void;
  say: (message: string) => void;
}) {
  const [draft, setDraft] = useState<FacetDraft[]>(facets);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update(index: number, patch: Partial<FacetDraft>) {
    setDraft((list) => list.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  function add() {
    setDraft((list) => [
      ...list,
      { key: keyFor('department', new Set(list.map((f) => f.key))), label: '', options: [], required: true },
    ]);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const taken = new Set<string>();
      const payload = draft
        .filter((f) => f.label.trim() !== '' && f.options.length >= 2)
        .map((f) => {
          const key = f.key && /^[a-z][a-z0-9_]*$/.test(f.key) ? f.key : keyFor(f.label, taken);
          taken.add(key);
          return { key, label: f.label.trim(), options: f.options, required: f.required };
        });
      await api.put(`/api/admin/collab-runs/${runId}/facets`, { facets: payload });
      say(payload.length === 0 ? 'Background questions cleared.' : 'Saved.');
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  }

  if (locked) {
    return (
      <div className="card-body">
        {facets.length === 0 ? (
          <p className="hint">
            This run asks no background questions, so its results cannot be broken down by department
            or anything else. People have already answered, so that is fixed for this wave — start a
            new wave to ask one next time.
          </p>
        ) : (
          <>
            <ul className="cd-facet-read">
              {facets.map((f) => (
                <li key={f.key}>
                  <b>{f.label}</b>
                  <span>{f.options.join(' · ')}</span>
                </li>
              ))}
            </ul>
            <p className="hint">
              Fixed for this wave. People chose from these lists, so renaming an answer now would
              rewrite what they said.
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="card-body">
      {draft.length === 0 && (
        <p className="hint" style={{ marginBottom: 14 }}>
          Nothing asked yet. Most runs ask one question — <b>Department</b> — so the results can show
          where Quality sees something Commercial does not. Any group smaller than the run&rsquo;s floor
          stays unreported.
        </p>
      )}
      <div className="cd-facets">
        {draft.map((facet, i) => (
          <div className="cd-facet" key={facet.key}>
            <div className="cd-facet-row">
              <input
                className="control"
                value={facet.label}
                placeholder="What to ask them, e.g. Department"
                onChange={(e) => update(i, { label: e.target.value })}
              />
              <label className="cd-inline hint">
                <input
                  type="checkbox"
                  checked={facet.required}
                  onChange={(e) => update(i, { required: e.target.checked })}
                />
                Must be answered
              </label>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setDraft((list) => list.filter((_, x) => x !== i))}
              >
                Remove
              </button>
            </div>
            <textarea
              className="control cd-facet-options"
              rows={Math.max(3, facet.options.length + 1)}
              value={facet.options.join('\n')}
              placeholder={'One answer per line\nOperations\nQuality & QA\nR&D'}
              onChange={(e) =>
                update(i, {
                  options: e.target.value
                    .split('\n')
                    .map((v) => v.trim())
                    .filter((v) => v !== ''),
                })
              }
            />
            <p className="hint">
              {facet.options.length < 2
                ? 'At least two answers to choose from, or there is nothing to compare.'
                : `${facet.options.length} answers. People pick one from this list; they cannot type their own.`}
            </p>
          </div>
        ))}
      </div>

      <div className="cd-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={add} disabled={draft.length >= 6}>
          Add a question
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
      {error ? (
        <div className="banner is-shown" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
