/** Sign-in card. The only unauthenticated view in the admin bundle. */

import { useState } from 'react';
import { ApiError, api } from '../lib/api.js';
import type { AdminUser } from '../../../src/shared/types.js';

export function Login({ onSignedIn }: { onSignedIn: (user: AdminUser) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ user: AdminUser }>('/api/admin/login', { email, password });
      onSignedIn(res.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wrap login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <div className="logo-slot" aria-hidden="true">
          A
        </div>
        <p className="eyebrow mt-4">Assessment Platform</p>
        <h1 className="display login-title">Sign in to the console</h1>
        <p className="hint mt-2">Administrator access only.</p>

        <div className="form-grid form-grid-1 mt-5">
          <div className="field field-full">
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              className="control"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="field field-full">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              className="control"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
        </div>

        {error ? (
          <div className="banner is-shown mt-4" role="alert">
            <span>{error}</span>
          </div>
        ) : null}

        <button className="btn btn-primary btn-lg btn-block mt-5" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
