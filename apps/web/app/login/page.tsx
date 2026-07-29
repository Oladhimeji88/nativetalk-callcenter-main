'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Eye, EyeOff } from 'lucide-react';
import { login, landingPath } from '@/lib/api';
import { DEMO } from '@/lib/demo';
import { DEMO_LOGINS } from '@/lib/demo/data';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await login(email, password, remember);
      router.push(landingPath());
    } catch (e: any) {
      setErr(e.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-stack">
        <div className="auth-logo">
          <Image src="/nativetalk-logo.svg" alt="NativeTalk" width={196} height={58} priority />
        </div>

        <div className="card auth-card">
          <h1 className="page-title" style={{ fontSize: 24 }}>Welcome back</h1>
          <p className="muted" style={{ marginBottom: 8 }}>Sign in to your NativeTalk workspace.</p>

          <form onSubmit={submit}>
            <label>Email address</label>
            <input
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            <label>Password</label>
            <div className="password-field">
              <input
                type={showPw ? 'text' : 'password'}
                placeholder="********"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={{ paddingRight: 48 }}
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? 'Hide password' : 'Show password'}
                title={showPw ? 'Hide password' : 'Show password'}
                className="password-toggle"
              >
                {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            <div className="auth-options">
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                Remember me
              </label>
              <Link href="/forgot-password" style={{ fontSize: 13, fontWeight: 700 }}>
                Forgot password?
              </Link>
            </div>

            {err && <div className="err">{err}</div>}

            <button
              className="btn btn-green"
              type="submit"
              disabled={busy}
              style={{ width: '100%', marginTop: 20, padding: '13px', fontSize: 15 }}
            >
              {busy ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          <p className="muted" style={{ marginTop: 20, textAlign: 'center', fontSize: 12 }}>
            Don't have an account? <Link href="/register">Create a workspace</Link>
          </p>
        </div>

        {DEMO && (
          <div className="demo-logins">
            <div className="demo-logins-head">
              <span className="demo-logins-title">Demo sign-ins</span>
              <span className="demo-logins-sub">Any password is accepted — pick a role to fill the form</span>
            </div>
            <div className="demo-logins-grid">
              {DEMO_LOGINS.map((d) => (
                <button
                  key={d.email}
                  type="button"
                  className="demo-login"
                  onClick={() => { setEmail(d.email); setPassword(d.password); setErr(''); }}
                >
                  <span className="demo-login-role">{d.label}</span>
                  <span className="demo-login-mail">{d.email}</span>
                  <span className="demo-login-blurb">{d.blurb}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <p className="auth-footer">(c) NativeTalk Cloud Communications</p>
      </div>
    </div>
  );
}
