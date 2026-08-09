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
    <div className="wrap" style={{ maxWidth: 420 }}>
      <form className="card" style={{ padding: 40, marginTop: 72 }} onSubmit={submit}>
        <div className="logo-slot" style={{ marginBottom: 20 }}>
          A
        </div>
        <p className="eyebrow">Assessment Platform</p>
        <h1 className="display" style={{ fontSize: 24, marginTop: 8 }}>
          Sign in to the console
        </h1>
        <p className="hint" style={{ marginTop: 10 }}>
          Administrator access only.
        </p>

        <div className="form-grid" style={{ gridTemplateColumns: '1fr', marginTop: 28 }}>
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
          <div className="banner is-shown" style={{ marginTop: 18 }} role="alert">
            <span>{error}</span>
          </div>
        ) : null}

        <button
          className="btn btn-primary btn-lg"
          type="submit"
          disabled={busy}
          style={{ width: '100%', marginTop: 24 }}
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
