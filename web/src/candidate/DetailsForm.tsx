/** Candidate details. Validated here and again on the server. */

import { useState } from 'react';
import { ApiError } from '../lib/api.js';
import type { CandidateDetails } from '../../../src/shared/types.js';

const AGE_BANDS = ['Under 25', '25–34', '35–44', '45–54', '55–64', '65 or over', 'Prefer not to say'];
const EXPERIENCE_BANDS = [
  'Less than 1 year',
  '1–5 years',
  '6–10 years',
  '11–15 years',
  '16–20 years',
  'More than 20 years',
];
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
          <p className="lede" style={{ fontSize: 16 }}>
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
              full
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

            <Field id="organisation" label={LABELS.organisation} error={errors.organisation} full>
              <input
                id="organisation"
                className="control"
                autoComplete="organization"
                value={values.organisation}
                onChange={(e) => set('organisation', e.target.value)}
              />
            </Field>

            <Field id="ageBand" label={LABELS.ageBand} error={errors.ageBand}>
              <Select
                id="ageBand"
                options={AGE_BANDS}
                value={values.ageBand}
                onChange={(v) => set('ageBand', v)}
              />
            </Field>

            <Field id="experienceBand" label={LABELS.experienceBand} error={errors.experienceBand}>
              <Select
                id="experienceBand"
                options={EXPERIENCE_BANDS}
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
