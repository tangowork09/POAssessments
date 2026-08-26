/**
 * Identity, for a cohort instrument: the respondent's work email — and, when
 * the facilitator has switched two-way binding on, the six-digit code mailed
 * to it.
 *
 * There is no name picker in either mode. A list of who is in the group is the
 * facilitator's information, and a link that reaches the wrong inbox must not
 * hand over sixty names. The enrolled email is the claim; with OTP on, the
 * mailed code is the proof the inbox is actually held by whoever is typing.
 */

import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api.js';
import type { CandidateCohort } from '../../../src/shared/types.js';

export function IdentityForm({
  cohort,
  initialEmail,
  onSubmit,
  onRequestCode,
  onBack,
}: {
  cohort: CandidateCohort;
  initialEmail: string;
  onSubmit: (identity: { email: string; otp?: string }) => Promise<void>;
  /** Asks the server to mail a code; resolves with its lifetime in minutes. */
  onRequestCode: (email: string) => Promise<{ minutes: number }>;
  onBack: () => void;
}) {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [minutes, setMinutes] = useState(10);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === 'code') codeRef.current?.focus();
  }, [step]);

  function validEmail(): string | null {
    const value = email.trim().toLowerCase();
    if (!value) return null;
    if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value)) return null;
    return value;
  }

  async function handleEmailSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setFormError(null);
    const value = validEmail();
    if (!value) {
      setFieldError(email.trim() ? 'Enter a valid email address' : 'Email address is required');
      return;
    }
    setFieldError(null);
    setBusy(true);
    try {
      if (cohort.otpRequired) {
        // Two-way binding: the code goes out first; identity completes on the
        // next screen once it comes back typed.
        const res = await onRequestCode(value);
        setMinutes(res.minutes);
        setResent(false);
        setStep('code');
      } else {
        await onSubmit({ email: value });
      }
    } catch (err) {
      if (err instanceof ApiError) {
        const details = err.details as { email?: string } | undefined;
        if (details?.email) setFieldError(details.email);
        setFormError(err.message);
      } else {
        setFormError('We could not save that. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleCodeSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setFormError(null);
    const value = validEmail();
    if (!value) return;
    if (!/^\d{6}$/.test(code.trim())) {
      setFieldError('Enter the 6-digit code from your email');
      return;
    }
    setFieldError(null);
    setBusy(true);
    try {
      await onSubmit({ email: value, otp: code.trim() });
    } catch (err) {
      if (err instanceof ApiError) {
        const details = err.details as { otp?: string; email?: string } | undefined;
        setFieldError(details?.otp ?? details?.email ?? null);
        setFormError(err.message);
      } else {
        setFormError('We could not save that. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function resend(): Promise<void> {
    const value = validEmail();
    if (!value) return;
    setBusy(true);
    setFormError(null);
    try {
      const res = await onRequestCode(value);
      setMinutes(res.minutes);
      setResent(true);
      setCode('');
      codeRef.current?.focus();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not send a new code. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (step === 'code') {
    return (
      <div className="stage">
        <form className="card formcard is-identity rise" onSubmit={handleCodeSubmit} noValidate>
          <div className="card-body">
            <span className="eyebrow">Step 1 of 2 · check your email</span>
            <h2 className="display">Enter your code</h2>
            <p className="lede">
              We sent a 6-digit code to <b>{email.trim().toLowerCase()}</b>. It works for {minutes}{' '}
              minutes. {resent ? 'A fresh code is on its way — only the newest one works.' : ''}
            </p>

            <div className={`field${fieldError ? ' has-error' : ''}`} style={{ marginTop: 20 }}>
              <label htmlFor="identity-otp">6-digit code</label>
              <input
                id="identity-otp"
                ref={codeRef}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                className="control otp-input"
                placeholder="••••••"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, ''));
                  setFieldError(null);
                }}
              />
              <p className="field-err">{fieldError ?? ''}</p>
            </div>

            {formError ? (
              <div className="banner is-shown" style={{ marginTop: 16 }}>
                <span>{formError}</span>
              </div>
            ) : null}

            <p className="hint" style={{ marginTop: 14 }}>
              Nothing arrived? Check spam, or{' '}
              <button type="button" className="link-btn" onClick={() => void resend()} disabled={busy}>
                send a new code
              </button>
              .
            </p>
          </div>

          <div className="form-foot">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setStep('email');
                setCode('');
                setFieldError(null);
                setFormError(null);
              }}
            >
              Back
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || code.length !== 6}>
              {busy ? 'Checking…' : 'Start rating'}
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="stage">
      <form className="card formcard is-identity rise" onSubmit={handleEmailSubmit} noValidate>
        <div className="card-body">
          <span className="eyebrow">Step 1 of 2</span>
          <h2 className="display">Sign in with your work email</h2>
          <p className="lede">
            {cohort.name}
            {cohort.organisation ? ` · ${cohort.organisation}` : ''}. Your facilitator has enrolled
            everyone taking part by email.{' '}
            {cohort.otpRequired
              ? 'Enter yours and we will send you a 6-digit code to confirm it is really you.'
              : 'Enter yours and, if it is on the list, your exercise opens — already set to the colleagues you have been asked about.'}
          </p>

          <div className={`field${fieldError ? ' has-error' : ''}`} style={{ marginTop: 20 }}>
            <label htmlFor="identity-email">Your work email</label>
            <input
              id="identity-email"
              type="email"
              className="control"
              inputMode="email"
              autoComplete="email"
              autoFocus
              placeholder="you@company.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setFieldError(null);
              }}
            />
            <p className="hint">
              Also where your own feedback reaches you afterwards. Your ratings are never shown to
              anyone alongside your name.
            </p>
            <p className="field-err">{fieldError ?? ''}</p>
          </div>

          {formError ? (
            <div className="banner is-shown" style={{ marginTop: 16 }}>
              <span>{formError}</span>
            </div>
          ) : null}
        </div>

        <div className="form-foot">
          <button type="button" className="btn btn-ghost" onClick={onBack}>
            Back
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? (cohort.otpRequired ? 'Sending code…' : 'Checking…') : cohort.otpRequired ? 'Email me a code' : 'Start rating'}
          </button>
        </div>
      </form>
    </div>
  );
}
