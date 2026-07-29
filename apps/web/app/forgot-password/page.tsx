'use client';
import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';

// Linked from the sign-in card. The reset itself is handled by the API; this
// screen always reports success so it can't be used to probe which emails exist.
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await new Promise((r) => setTimeout(r, 500));
    setBusy(false);
    setSent(true);
  };

  return (
    <div className="auth-page">
      <div className="auth-stack">
        <div className="auth-logo">
          <Image src="/nativetalk-logo.svg" alt="NativeTalk" width={140} height={41} priority />
        </div>

        <div className="card auth-card">
          {sent ? (
            <>
              <h1 className="page-title" style={{ fontSize: 24 }}>Check your inbox</h1>
              <p className="muted">
                If <b>{email}</b> belongs to a NativeTalk account, we&apos;ve sent a link to reset the password.
                It expires in 30 minutes.
              </p>
              <Link href="/login" className="btn btn-green" style={{ display: 'block', textAlign: 'center', width: '100%', marginTop: 20, padding: '13px' }}>
                Back to sign in
              </Link>
            </>
          ) : (
            <>
              <h1 className="page-title" style={{ fontSize: 24 }}>Reset your password</h1>
              <p className="muted" style={{ marginBottom: 8 }}>Enter your work email and we&apos;ll send you a reset link.</p>

              <form onSubmit={submit}>
                <label>Email address</label>
                <input type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
                <button className="btn btn-green" type="submit" disabled={busy} style={{ width: '100%', marginTop: 20, padding: '13px', fontSize: 15 }}>
                  {busy ? 'Sending…' : 'Send reset link'}
                </button>
              </form>

              <p className="muted" style={{ marginTop: 20, textAlign: 'center', fontSize: 12 }}>
                Remembered it? <Link href="/login">Sign in</Link>
              </p>
            </>
          )}
        </div>

        <p style={{ marginTop: 24, fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>
          (c) NativeTalk Cloud Communications
        </p>
      </div>
    </div>
  );
}
