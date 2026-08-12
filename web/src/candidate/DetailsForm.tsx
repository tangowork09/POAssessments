/** Candidate details. Validated here and again on the server. */

import { useState } from 'react';
import { ApiError } from '../lib/api.js';
import {
  AGE_MAX,
  AGE_MIN,
  EXPERIENCE_MAX,
  EXPERIENCE_MIN,
  type CandidateDetails,
} from '../../../src/shared/types.js';

const GENDERS = ['Female', 'Male', 'Non-binary', 'Prefer to self-describe', 'Prefer not to say'];

const EMPTY: CandidateDetails = {
  firstName: '',
  lastName: '',
  email: '',
  organisation: '',
  ageBand: '',
  experienceBand: '',
  gender: '',
};

const LABELS: Record<keyof CandidateDetails, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  email: 'Email address',
  organisation: 'Organisation',
  ageBand: 'Age',
  experienceBand: 'Years of work experience',
  gender: 'Gender',
};

export function DetailsForm({
  initial,
  lockedEmail,
  onSubmit,
  onBack,
}: {
  initial: CandidateDetails | null;
  lockedEmail: string | null;
  onSubmit: (details: CandidateDetails) => Promise<void>;
  onBack: () => void;
}) {
  const [values, setValues] = useState<CandidateDetails>({ ...EMPTY, ...initial });
  const [errors, setErrors] = useState<Partial<Record<keyof CandidateDetails, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof CandidateDetails, value: string): void => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  function validate(): boolean {
    const next: Partial<Record<keyof CandidateDetails, string>> = {};
    for (const key of Object.keys(EMPTY) as (keyof CandidateDetails)[]) {
      if (!values[key].trim()) next[key] = `${LABELS[key]} is required`;
    }
    if (values.email.trim() && !/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(values.email.trim())) {
      next.email = 'Enter a valid email address';
    }
    // The slider cannot leave the range, but the number input it is paired with
    // can be typed into, so the bound is checked rather than assumed.
    const inRange = (v: string, min: number, max: number): boolean =>
      /^\d+$/.test(v) && Number(v) >= min && Number(v) <= max;
    if (values.ageBand.trim() && !inRange(values.ageBand, AGE_MIN, AGE_MAX)) {
      next.ageBand = `Enter an age between ${AGE_MIN} and ${AGE_MAX}`;
    }
    if (values.experienceBand.trim() && !inRange(values.experienceBand, EXPERIENCE_MIN, EXPERIENCE_MAX)) {
      next.experienceBand = `Enter a number between ${EXPERIENCE_MIN} and ${EXPERIENCE_MAX}`;
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setFormError(null);
    if (!validate()) return;
    setBusy(true);
    try {
      await onSubmit({ ...values, email: values.email.trim().toLowerCase() });
    } catch (err) {
      if (err instanceof ApiError && err.details) {
        setErrors(err.details as Partial<Record<keyof CandidateDetails, string>>);
        setFormError(err.message);
      } else {
        setFormError('We could not save your details. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stage">
      <form className="card formcard rise" onSubmit={handleSubmit} noValidate>
        <div className="card-body">
          <span className="eyebrow">Step 1 of 2</span>
          <h2 className="display">A few details first</h2>
          <p className="lede">
            This is what appears on the front of your report and where we send it. Nothing is shared
            outside the organisation that invited you.
          </p>

          <div className="form-grid">
            <Field id="firstName" label={LABELS.firstName} error={errors.firstName}>
              <input
                id="firstName"
                className="control"
                autoComplete="given-name"
                value={values.firstName}
                onChange={(e) => set('firstName', e.target.value)}
              />
            </Field>

            <Field id="lastName" label={LABELS.lastName} error={errors.lastName}>
              <input
                id="lastName"
                className="control"
                autoComplete="family-name"
                value={values.lastName}
                onChange={(e) => set('lastName', e.target.value)}
              />
            </Field>

            <Field
              id="email"
              label={LABELS.email}
              error={errors.email}
              hint={lockedEmail ? 'Your report will be sent to this address.' : undefined}
            >
              <input
                id="email"
                type="email"
                className="control"
                autoComplete="email"
                inputMode="email"
                readOnly={Boolean(lockedEmail)}
                value={lockedEmail ?? values.email}
                onChange={(e) => set('email', e.target.value)}
              />
            </Field>

            <Field id="organisation" label={LABELS.organisation} error={errors.organisation}>
              <input
                id="organisation"
                className="control"
                autoComplete="organization"
                value={values.organisation}
                onChange={(e) => set('organisation', e.target.value)}
              />
            </Field>

            <Field id="ageBand" label={LABELS.ageBand} error={errors.ageBand}>
              <YearsInput
                id="ageBand"
                label={LABELS.ageBand}
                min={AGE_MIN}
                max={AGE_MAX}
                value={values.ageBand}
                onChange={(v) => set('ageBand', v)}
              />
            </Field>

            <Field id="experienceBand" label={LABELS.experienceBand} error={errors.experienceBand}>
              <YearsInput
                id="experienceBand"
                label={LABELS.experienceBand}
                min={EXPERIENCE_MIN}
                max={EXPERIENCE_MAX}
                value={values.experienceBand}
                onChange={(v) => set('experienceBand', v)}
              />
            </Field>

            <Field id="gender" label={LABELS.gender} error={errors.gender} full>
              <Select id="gender" options={GENDERS} value={values.gender} onChange={(v) => set('gender', v)} />
            </Field>
          </div>

          {formError ? (
            <div className="banner is-shown" style={{ marginTop: 20 }}>
              <span>{formError}</span>
            </div>
          ) : null}
        </div>

        {/* Outside the scrolling field area: on a short screen the fields give,
            never the way forward. */}
        <div className="form-foot">
          <button type="button" className="btn btn-ghost" onClick={onBack}>
            Back
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Start question 1'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  id,
  label,
  error,
  full,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  full?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`field${full ? ' field-full' : ''}${error ? ' has-error' : ''}`}>
      <label htmlFor={id}>
        {label}
        <span className="req">*</span>
      </label>
      {children}
      {hint && !error ? (
        <p className="hint" style={{ fontSize: 13 }}>
          {hint}
        </p>
      ) : null}
      <p className="field-err" role="alert">
        {error}
      </p>
    </div>
  );
}

/**
 * An exact number, offered two ways at once: a box to type into and a slider to
 * drag. They are one value, so neither is authoritative — whichever the
 * candidate touches writes the same state and the other follows.
 *
 * The two sit on one line rather than stacked because this field shares a row
 * with its twin and the card must not scroll; a stacked slider would add a
 * whole row of height to the form for a control the select it replaced did not
 * need.
 */
function YearsInput({
  id,
  label,
  min,
  max,
  value,
  onChange,
}: {
  id: string;
  label: string;
  min: number;
  max: number;
  value: string;
  onChange: (value: string) => void;
}) {
  // Empty is a real state — nothing has been chosen yet, and the form requires
  // a choice. The slider has no way to express it, so it parks at `min` and is
  // greyed until the value exists; it must not read as "16 is already picked".
  const unset = value.trim() === '';
  const numeric = unset ? min : Number(value);
  const slider = Number.isFinite(numeric) ? Math.min(Math.max(numeric, min), max) : min;
  const pct = max > min ? ((slider - min) / (max - min)) * 100 : 0;

  return (
    <div className={`yearsfield${unset ? ' is-unset' : ''}`}>
      <input
        id={id}
        type="number"
        className="control years-num"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={value}
        placeholder="–"
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, '').slice(0, 3))}
        onBlur={(e) => {
          const raw = e.target.value.trim();
          if (raw === '') return;
          onChange(String(Math.min(Math.max(Number(raw), min), max)));
        }}
      />
      <input
        type="range"
        className="years-range"
        // The number box already carries the field's label; this is the same
        // value by another handle, so it is named rather than labelled twice.
        aria-label={`${label} slider`}
        min={min}
        max={max}
        step={1}
        value={slider}
        style={{ ['--fill' as string]: `${pct}%` }}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="years-max" aria-hidden="true">
        {max}
      </span>
    </div>
  );
}

function Select({
  id,
  options,
  value,
  onChange,
}: {
  id: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <select id={id} className="control" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select…</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}
