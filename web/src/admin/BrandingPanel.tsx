/**
 * Branding. What is set here reaches the candidate UI, the PDF report and the
 * emails, because all three read the same settings rows.
 */

import { useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../lib/api.js';
import { Head, Loading, Toast, useToast } from './ui.js';
import type { Branding } from '../../../src/shared/types.js';

const MAX_LOGO_BYTES = 1_000_000;

export function BrandingPanel() {
  const [branding, setBranding] = useState<Branding | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, showToast] = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get<{ branding: Branding }>('/api/admin/branding').then((r) => setBranding(r.branding));
  }, []);

  if (!branding) return <Loading />;

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
          <div className="card-head">
            <div>
              <div className="card-title">Identity</div>
              <div className="card-sub">Shown on the assessment, the report and outbound mail</div>
            </div>
          </div>
          <div className="card-body">
            <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
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
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <input
                    type="color"
                    value={/^#[0-9a-fA-F]{6}$/.test(branding.accentColor) ? branding.accentColor : '#1A4FD6'}
                    onChange={(e) => set({ accentColor: e.target.value.toUpperCase() })}
                    aria-label="Pick accent colour"
                    style={{ width: 44, height: 40, padding: 2, border: '1px solid var(--line-2)', borderRadius: 6 }}
                  />
                  <input
                    id="b-accent"
                    className="control"
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
                    <img
                      src={branding.logoDataUrl}
                      alt="Current logo"
                      style={{ maxHeight: 56, maxWidth: 200, margin: '0 auto', display: 'block' }}
                    />
                  ) : (
                    <span>No logo uploaded — the company initial is used instead.</span>
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
                      className="link-btn"
                      style={{ marginTop: 10 }}
                      onClick={() => {
                        set({ logoDataUrl: '' });
                        if (fileRef.current) fileRef.current.value = '';
                      }}
                    >
                      Remove logo
                    </button>
                  ) : null}
                </div>
                <p className="inline-note" style={{ marginTop: 8 }}>
                  PNG, JPEG, SVG or WebP up to 1 MB. Stored in the database as a data URL, so no bucket is
                  needed.
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
              <button className="btn btn-primary" onClick={save} disabled={busy}>
                {busy ? 'Saving…' : 'Save branding'}
              </button>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Preview</div>
              <div className="card-sub">How the header reads to a candidate</div>
            </div>
          </div>
          <div className="card-body">
            <div
              style={{
                border: '1px solid var(--line)',
                borderRadius: 8,
                padding: 16,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                background: 'var(--surface-2)',
              }}
            >
              {branding.logoDataUrl ? (
                <img
                  src={branding.logoDataUrl}
                  alt=""
                  style={{ width: 32, height: 32, objectFit: 'contain', borderRadius: 6 }}
                />
              ) : (
                <div className="logo-slot" style={{ background: branding.accentColor }}>
                  {(branding.companyName || 'A').charAt(0).toUpperCase()}
                </div>
              )}
              <div className="brand-text">
                <span className="brand-name">{branding.companyName || 'Your organisation'}</span>
                <span className="brand-sub">Influencing Style Inventory</span>
              </div>
            </div>

            <button
              className="btn btn-primary"
              style={{ marginTop: 16, background: branding.accentColor }}
              type="button"
            >
              Start the assessment
            </button>

            <p className="inline-note" style={{ marginTop: 16 }}>
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
