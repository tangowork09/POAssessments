/**
 * What a Collaboration Diagnostic respondent is asked before the statements.
 *
 * Deliberately almost nothing. The two self-rating instruments ask for a name,
 * an age band, years of experience and a gender, because their report is about
 * the person answering. This one reports on an organisation: none of those
 * change a section mean, and asking for them in a run promised as anonymous
 * would be a lie told in a form field.
 *
 * So the page asks only what the reading needs — the background questions the
 * facilitator chose, which are what makes "Quality see this and Commercial do
 * not" sayable — plus an email on a named run, and only when the link does not
 * already know who is holding it.
 */

import { useState } from 'react';
import type { CollabRunForCandidate } from '../../../src/shared/types.js';

export function CollabDetails({
  run,
  needsEmail,
  initialEmail,
  onSubmit,
  onBack,
}: {
  run: CollabRunForCandidate;
  /** True on a shared link into a named run: nobody knows who this is yet. */
  needsEmail: boolean;
  initialEmail: string;
  onSubmit: (input: { email: string; facets: Record<string, string> }) => Promise<void>;
  onBack: () => void;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [chosen, setChosen] = useState<Record<string, string>>(run.chosen ?? {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Anything the facilitator already recorded about this person is not asked
  // again: they wrote "Operations" on the roster, so there is nothing here for
  // the respondent to spell differently.
  const toAsk = run.facets.filter((facet) => !(run.chosen ?? {})[facet.key]);
  const missing = toAsk.filter((facet) => facet.required && !chosen[facet.key]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (needsEmail && !/^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/.test(email.trim())) {
      setError('Please enter the email address your invitation was sent to.');
      return;
    }
    if (missing.length > 0) {
      setError(`Please choose your ${missing[0]!.label.toLowerCase()}.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ email: email.trim().toLowerCase(), facets: chosen });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We could not start the questionnaire. Please try again.');
      setBusy(false);
    }
  }

  const nothingToAsk = toAsk.length === 0 && !needsEmail;

  return (
    <form className="card formcard rise" onSubmit={submit} noValidate>
      <p className="step-pill">Step 1 of 2</p>
      <h1 className="formcard-title">{nothingToAsk ? 'Ready when you are' : 'One or two things first'}</h1>
      <p className="formcard-lede">
        {run.anonymous
          ? 'Your answers are stored separately from you: nobody, including the facilitation team, can see which answers are yours.'
          : 'Your individual answers are seen only by the facilitation team and are never shown to anyone in your organisation.'}
      </p>

      <div className="fieldset">
        {needsEmail && (
          <label className="field">
            <span className="field-label">
              Email address <b aria-hidden>*</b>
            </span>
            <input
              className="input"
              type="email"
              value={email}
              autoComplete="email"
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@yourcompany.com"
            />
            <span className="field-hint">
              Only so the facilitator can see who still has the questionnaire outstanding.
            </span>
          </label>
        )}

        {toAsk.map((facet) => (
          <fieldset className="field" key={facet.key}>
            <legend className="field-label">
              {facet.label} {facet.required && <b aria-hidden>*</b>}
            </legend>
            <div className="choice-row">
              {facet.options.map((option) => (
                <button
                  key={option}
                  type="button"
                  className="choice"
                  aria-pressed={chosen[facet.key] === option}
                  onClick={() =>
                    setChosen((prev) =>
                      prev[facet.key] === option
                        ? { ...prev, [facet.key]: '' }
                        : { ...prev, [facet.key]: option },
                    )
                  }
                >
                  {option}
                </button>
              ))}
            </div>
            <span className="field-hint">
              {facet.required
                ? 'Used only to compare groups. Any group too small to stay anonymous is left out of the results.'
                : 'You may leave this blank.'}
            </span>
          </fieldset>
        ))}

        {nothingToAsk && (
          <p className="field-hint">
            Nothing to fill in. The next screen is the first of the 24 statements.
          </p>
        )}
      </div>

      {error && (
        <p className="formcard-error" role="alert">
          {error}
        </p>
      )}

      <div className="formcard-actions">
        <button type="button" className="btn btn-ghost" onClick={onBack} disabled={busy}>
          Back
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Starting…' : 'Start question 1'}
        </button>
      </div>
    </form>
  );
}
