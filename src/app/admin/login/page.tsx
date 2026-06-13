'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';

export default function AdminLogin() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        router.push('/admin');
      } else {
        setError('Invalid password');
      }
    } catch {
      setError('Connection error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-wrapper">
      <main className="page-container">
        <div className="login-container fade-in">
          <div className="login-card">
            <div className="login-logo-container">
              <Image
                src="/icon.png"
                alt="Statoo Logo"
                className="login-logo"
                width={96}
                height={96}
                priority
              />
            </div>
            <h1 className="login-title">Admin Login</h1>
            <p className="login-subtitle">Enter your admin password to continue</p>

            <form onSubmit={handleSubmit} className="login-form">
              <div className="form-group">
                <label htmlFor="password" className="form-label">Password</label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="form-input"
                  placeholder="Enter admin password"
                  autoFocus
                  required
                />
              </div>

              {error && <div className="form-error">{error}</div>}

              <button
                type="submit"
                className="btn btn-primary btn-full"
                disabled={loading}
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
            </form>

            <Link href="/" className="login-back">← Back to status page</Link>
          </div>
        </div>
      </main>
    </div>
  );
}
