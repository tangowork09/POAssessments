/**
 * Branding. What is set here reaches the candidate UI, the PDF report and the
 * emails, because all three read the same settings rows.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../lib/api.js';
import { CardHead, ErrorState, Head, Loading, Toast, useToast } from './ui.js';
import type { Branding } from '../../../src/shared/types.js';

const MAX_LOGO_BYTES = 1_000_000;

export function BrandingPanel() {
  const [branding, setBranding] = useState<Branding | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, showToast] = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setLoadError(null);
    api
      .get<{ branding: Branding }>('/api/admin/branding')
      .then((r) => setBranding(r.branding))
      .catch((e: unknown) =>
        setLoadError(
          e instanceof ApiError && e.status === 403
            ? 'Branding is restricted to super admin accounts.'
            : e instanceof Error
              ? e.message
              : 'Branding could not be loaded.',
        ),
      );
  }, []);

  useEffect(load, [load]);

  if (loadError) {
    return (
      <>
        <Head title="Branding" />
        <section className="card">
          <ErrorState message={loadError} onRetry={load} />
        </section>
      </>
    );
  }
  if (!branding) return <Loading label="Loading branding…" />;

  const set = (patch: Partial<Branding>): void => setBranding({ ...branding, ...patch });

  async function onLogo(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) {
      setError('That logo is larger than 1 MB. Please use a smaller file.');
      return;
    }
    setError(null);
    const reader = new FileReader();
    reader.onload = () => set({ logoDataUrl: String(reader.result) });
    reader.readAsDataURL(file);
  }

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      const res = await api.put<{ branding: Branding }>('/api/admin/branding', branding);
      setBranding(res.branding);
      showToast('Branding saved — it applies to new emails and reports immediately');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        if (err.details) setErrors(err.details);
      } else {
        setError('Could not save branding');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Head title="Branding" sub="Applied to the candidate experience, the PDF report and every email." />

      <div className="grid-2">
        <section className="card">
          <CardHead title="Identity" sub="Shown on the assessment, the report and outbound mail" />
          <div className="card-body">
            <div className="form-grid form-grid-1">
              <div className={`field field-full${errors.companyName ? ' has-error' : ''}`}>
                <label htmlFor="b-name">Company name</label>
                <input
                  id="b-name"
                  className="control"
                  value={branding.companyName}
                  onChange={(e) => set({ companyName: e.target.value })}
                />
                <p className="field-err">{errors.companyName}</p>
              </div>

              <div className={`field field-full${errors.accentColor ? ' has-error' : ''}`}>
                <label htmlFor="b-accent">Accent colour</label>
                <div className="colour-row">
                  {/*
                    <input type="color"> rejects anything but a literal
                    six-digit hex, so a var() is not an option here. The
                    fallback is the same value as --accent in base.css.
                  */}
                  <input
                    type="color"
                    className="colour-swatch"
                    value={/^#[0-9a-fA-F]{6}$/.test(branding.accentColor) ? branding.accentColor : '#1A4FD6'}
                    onChange={(e) => set({ accentColor: e.target.value.toUpperCase() })}
                    aria-label="Pick accent colour"
                  />
                  <input
                    id="b-accent"
                    className="control num"
                    value={branding.accentColor}
                    onChange={(e) => set({ accentColor: e.target.value })}
                  />
                </div>
                <p className="field-err">{errors.accentColor}</p>
              </div>

              <div className={`field field-full${errors.supportEmail ? ' has-error' : ''}`}>
                <label htmlFor="b-support">Reply-to address</label>
                <input
                  id="b-support"
                  type="email"
                  className="control"
                  placeholder="Optional"
                  value={branding.supportEmail}
                  onChange={(e) => set({ supportEmail: e.target.value })}
                />
                <p className="field-err">{errors.supportEmail}</p>
              </div>

              <div className="field field-full">
                <label htmlFor="b-logo">Logo</label>
                <div className="file-drop">
                  {branding.logoDataUrl ? (
                    <img className="logo-preview" src={branding.logoDataUrl} alt="Current logo" />
                  ) : (
                    <>
                      <b>No logo set</b>
                      <span>Saving now restores the house PO Motivation mark.</span>
                    </>
                  )}
                  <input
                    id="b-logo"
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/svg+xml,image/webp"
                    onChange={onLogo}
                  />
                  {branding.logoDataUrl ? (
                    <button
                      className="link-btn mt-2"
                      type="button"
                      onClick={() => {
                        set({ logoDataUrl: '' });
                        if (fileRef.current) fileRef.current.value = '';
                      }}
                    >
                      Reset to the PO Motivation logo
                    </button>
                  ) : null}
                </div>
                <p className="inline-note mt-2">
                  PNG, JPEG, SVG or WebP up to 1 MB, stored in the database as a data URL. A wide lockup
                  works best — the house mark is 331 × 140. There is never no logo: clearing yours restores
                  the PO Motivation one.
                </p>
              </div>
            </div>

            {error ? (
              <div className="banner is-shown" role="alert">
                <span>{error}</span>
              </div>
            ) : null}

            <div className="form-foot">
              <span className="inline-note">Existing reports keep the branding they were issued with.</span>
              <button className="btn btn-primary" type="button" onClick={save} disabled={busy}>
                {busy ? 'Saving…' : 'Save branding'}
              </button>
            </div>
          </div>
        </section>

        <section className="card">
          <CardHead title="Preview" sub="How the header reads to a candidate" />
          <div className="card-body">
            <div className="brand-preview">
              {branding.logoDataUrl ? (
                <img className="brand-preview-logo" src={branding.logoDataUrl} alt="" />
              ) : (
                <div className="logo-slot" style={{ background: branding.accentColor }} aria-hidden="true">
                  {(branding.companyName || 'A').charAt(0).toUpperCase()}
                </div>
              )}
              <div className="brand-text">
                <span className="brand-name">{branding.companyName || 'Your organisation'}</span>
                {/* Neutral: the same header serves every instrument. */}
                <span className="brand-sub">Assessment</span>
              </div>
            </div>

            {/* A span, not a button: it is a picture of the candidate's CTA, not one. */}
            <span className="btn btn-primary mt-4 is-preview" style={{ background: branding.accentColor }}>
              Start the assessment
            </span>

            <p className="inline-note mt-4">
              The accent drives the primary button, focus rings, progress bar, the Pull data colour and the
              accent marks in the PDF. Push keeps its warm clay hue so the two data series stay
              distinguishable.
            </p>
          </div>
        </section>
      </div>

      <Toast message={toast} />
    </>
  );
}
