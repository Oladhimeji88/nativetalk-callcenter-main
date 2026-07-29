'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { MailCheck, ArrowLeft, Eye, EyeOff, Check, X, ShieldCheck } from 'lucide-react';

/* Password reset, in four steps:
 *   1. request  — enter the account email
 *   2. code     — 6-digit code from the email
 *   3. reset    — choose a new password, with live strength rules
 *   4. done     — confirmation, back to sign in
 *
 * Step 1 always reports success whether or not the address exists, so the form
 * can't be used to discover who has an account.
 */
type Step = 'request' | 'code' | 'reset' | 'done';

const RULES = [
  { key: 'len', label: 'At least 8 characters', test: (v: string) => v.length >= 8 },
  { key: 'case', label: 'Upper and lower case', test: (v: string) => /[a-z]/.test(v) && /[A-Z]/.test(v) },
  { key: 'num', label: 'A number', test: (v: string) => /\d/.test(v) },
  { key: 'sym', label: 'A symbol', test: (v: string) => /[^A-Za-z0-9]/.test(v) },
];

const CODE_LENGTH = 6;
const RESEND_SECONDS = 30;

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState<string[]>(Array(CODE_LENGTH).fill(''));
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const boxes = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const passed = RULES.filter((r) => r.test(password));
  const strength = passed.length;
  const strengthLabel = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'][strength];

  /* ---- step 1: request ---- */
  const sendLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (!/^\S+@\S+\.\S+$/.test(email)) { setErr('Enter a valid email address'); return; }
    setBusy(true);
    await new Promise((r) => setTimeout(r, 700));
    setBusy(false);
    setCooldown(RESEND_SECONDS);
    setStep('code');
    setTimeout(() => boxes.current[0]?.focus(), 60);
  };

  /* ---- step 2: code ---- */
  const setDigit = (i: number, v: string) => {
    const digit = v.replace(/\D/g, '').slice(-1);
    const next = [...code];
    next[i] = digit;
    setCode(next);
    setErr('');
    if (digit && i < CODE_LENGTH - 1) boxes.current[i + 1]?.focus();
  };

  const onCodeKey = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !code[i] && i > 0) boxes.current[i - 1]?.focus();
    if (e.key === 'ArrowLeft' && i > 0) boxes.current[i - 1]?.focus();
    if (e.key === 'ArrowRight' && i < CODE_LENGTH - 1) boxes.current[i + 1]?.focus();
  };

  // Pasting the whole code into any box should just work.
  const onCodePaste = (e: React.ClipboardEvent) => {
    const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, CODE_LENGTH);
    if (!digits) return;
    e.preventDefault();
    const next = Array(CODE_LENGTH).fill('');
    digits.split('').forEach((d, i) => { next[i] = d; });
    setCode(next);
    boxes.current[Math.min(digits.length, CODE_LENGTH - 1)]?.focus();
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (code.some((c) => !c)) { setErr(`Enter all ${CODE_LENGTH} digits`); return; }
    setBusy(true);
    await new Promise((r) => setTimeout(r, 600));
    setBusy(false);
    setStep('reset');
  };

  const resend = async () => {
    if (cooldown > 0) return;
    setCode(Array(CODE_LENGTH).fill(''));
    setCooldown(RESEND_SECONDS);
    boxes.current[0]?.focus();
  };

  /* ---- step 3: reset ---- */
  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (strength < RULES.length) { setErr('Your password does not meet all the requirements yet'); return; }
    if (password !== confirm) { setErr('The two passwords do not match'); return; }
    setBusy(true);
    await new Promise((r) => setTimeout(r, 700));
    setBusy(false);
    setStep('done');
  };

  const STEP_INDEX: Record<Step, number> = { request: 0, code: 1, reset: 2, done: 3 };

  return (
    <div className="auth-page">
      <div className="auth-stack">
        <div className="auth-logo">
          <Image src="/nativetalk-logo.svg" alt="NativeTalk" width={196} height={58} priority />
        </div>

        {step !== 'done' && (
          <ol className="pwsteps" aria-label="Password reset progress">
            {['Your email', 'Verify', 'New password'].map((label, i) => (
              <li key={label} className={i < STEP_INDEX[step] ? 'is-done' : i === STEP_INDEX[step] ? 'is-current' : ''}>
                <span className="pwstep-dot">{i < STEP_INDEX[step] ? <Check size={12} /> : i + 1}</span>
                <span className="pwstep-label">{label}</span>
              </li>
            ))}
          </ol>
        )}

        <div className="card auth-card">
          {step === 'request' && (
            <>
              <h1 className="page-title auth-title">Reset your password</h1>
              <p className="muted auth-lede">
                Enter the email you sign in with and we&apos;ll send a 6-digit verification code.
              </p>
              <form onSubmit={sendLink}>
                <label htmlFor="fp-email">Email address</label>
                <input
                  id="fp-email" type="email" autoComplete="email" autoFocus
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setErr(''); }}
                />
                {err && <div className="err">{err}</div>}
                <button className="btn btn-green auth-submit" type="submit" disabled={busy}>
                  {busy ? 'Sending…' : 'Send verification code'}
                </button>
              </form>
              <Link href="/login" className="auth-back"><ArrowLeft size={14} /> Back to sign in</Link>
            </>
          )}

          {step === 'code' && (
            <>
              <div className="auth-icon"><MailCheck size={22} /></div>
              <h1 className="page-title auth-title">Check your email</h1>
              <p className="muted auth-lede">
                If <b>{email}</b> has an account, a 6-digit code is on its way. It expires in 10 minutes.
              </p>
              <form onSubmit={verify}>
                <div className="pwcode" onPaste={onCodePaste}>
                  {code.map((d, i) => (
                    <input
                      key={i}
                      ref={(el) => { boxes.current[i] = el; }}
                      className={`pwcode-box ${d ? 'is-filled' : ''}`}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={1}
                      aria-label={`Digit ${i + 1} of ${CODE_LENGTH}`}
                      value={d}
                      onChange={(e) => setDigit(i, e.target.value)}
                      onKeyDown={(e) => onCodeKey(i, e)}
                    />
                  ))}
                </div>
                {err && <div className="err">{err}</div>}
                <button className="btn btn-green auth-submit" type="submit" disabled={busy}>
                  {busy ? 'Verifying…' : 'Verify code'}
                </button>
              </form>
              <div className="auth-foot-row">
                <button type="button" className="linklike" onClick={resend} disabled={cooldown > 0}>
                  {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
                </button>
                <button type="button" className="linklike" onClick={() => { setStep('request'); setErr(''); }}>
                  Use a different email
                </button>
              </div>
            </>
          )}

          {step === 'reset' && (
            <>
              <div className="auth-icon"><ShieldCheck size={22} /></div>
              <h1 className="page-title auth-title">Choose a new password</h1>
              <p className="muted auth-lede">Make it something you haven&apos;t used on this account before.</p>

              <form onSubmit={savePassword}>
                <label htmlFor="fp-pw">New password</label>
                <div className="password-field">
                  <input
                    id="fp-pw" type={showPw ? 'text' : 'password'} autoComplete="new-password" autoFocus
                    value={password} onChange={(e) => { setPassword(e.target.value); setErr(''); }}
                    className="has-toggle"
                  />
                  <button
                    type="button" className="password-toggle"
                    onClick={() => setShowPw((v) => !v)}
                    aria-label={showPw ? 'Hide password' : 'Show password'}
                  >
                    {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>

                <div className="pwmeter" aria-live="polite">
                  <div className="pwmeter-track">
                    {RULES.map((_, i) => (
                      <span key={i} className={`pwmeter-seg ${i < strength ? `is-${Math.min(strength, 4)}` : ''}`} />
                    ))}
                  </div>
                  <span className="pwmeter-label">{password ? strengthLabel : ' '}</span>
                </div>

                <ul className="pwrules">
                  {RULES.map((r) => {
                    const ok = r.test(password);
                    return (
                      <li key={r.key} className={ok ? 'is-ok' : ''}>
                        {ok ? <Check size={13} /> : <X size={13} />} {r.label}
                      </li>
                    );
                  })}
                </ul>

                <label htmlFor="fp-pw2">Confirm password</label>
                <input
                  id="fp-pw2" type={showPw ? 'text' : 'password'} autoComplete="new-password"
                  value={confirm} onChange={(e) => { setConfirm(e.target.value); setErr(''); }}
                />
                {confirm && confirm !== password && <p className="pwmismatch">The passwords don&apos;t match yet.</p>}

                {err && <div className="err">{err}</div>}
                <button className="btn btn-green auth-submit" type="submit" disabled={busy}>
                  {busy ? 'Saving…' : 'Set new password'}
                </button>
              </form>
            </>
          )}

          {step === 'done' && (
            <div className="auth-done">
              <div className="auth-icon is-success"><Check size={26} /></div>
              <h1 className="page-title auth-title">Password updated</h1>
              <p className="muted auth-lede">
                You can now sign in with your new password. Any other devices signed into this account have been signed out.
              </p>
              <button type="button" className="btn btn-green auth-submit" onClick={() => router.push('/login')}>
                Go to sign in
              </button>
            </div>
          )}
        </div>

        <p className="auth-footer">(c) NativeTalk Cloud Communications</p>
      </div>
    </div>
  );
}
