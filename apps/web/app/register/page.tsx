'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { register, signupPlans, SignupPlan, landingPath } from '@/lib/api';

const money = (minor: number, currency: string) =>
  minor <= 0 ? 'Free' : `${currency} ${(minor / 100).toLocaleString()}/mo`;

export default function RegisterPage() {
  const router = useRouter();
  const [company, setCompany] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [plans, setPlans] = useState<SignupPlan[]>([]);
  const [planId, setPlanId] = useState<string>('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // Plans are optional — show them if the platform has any, otherwise sign up
  // on a plain trial. A failed fetch shouldn't block signup.
  useEffect(() => {
    signupPlans().then(setPlans).catch(() => setPlans([]));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (password.length < 8) return setErr('Password must be at least 8 characters');
    if (password !== confirm) return setErr('Passwords do not match');
    setBusy(true);
    try {
      const r = await register({
        company,
        email,
        password,
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        planId: planId || undefined,
      });
      router.push(landingPath());
    } catch (e: any) {
      setErr(e.message || 'Sign up failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center">
      <form className="card" style={{ width: 420 }} onSubmit={submit}>
        <Image src="/nativetalk-logo.svg" alt="NativeTalk" width={140} height={41} style={{ marginBottom: 4 }} />
        <p className="muted" style={{ marginTop: 4 }}>Create your company workspace</p>

        <label>Company name</label>
        <input value={company} onChange={(e) => setCompany(e.target.value)} required placeholder="Acme Telecoms Ltd" />

        <div className="row" style={{ gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label>First name</label>
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Optional" />
          </div>
          <div style={{ flex: 1 }}>
            <label>Last name</label>
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Optional" />
          </div>
        </div>

        <label>Work email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@company.com" />

        <div className="row" style={{ gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="Min. 8 characters" />
          </div>
          <div style={{ flex: 1 }}>
            <label>Confirm password</label>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </div>
        </div>

        {plans.length > 0 && (
          <>
            <label>Plan</label>
            <select value={planId} onChange={(e) => setPlanId(e.target.value)}>
              <option value="">Trial (choose a plan later)</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {money(p.priceMonthly, p.currency)}
                </option>
              ))}
            </select>
          </>
        )}

        {err && <div className="err">{err}</div>}

        <button className="btn btn-green" style={{ width: '100%', marginTop: 16 }} disabled={busy}>
          {busy ? 'Creating workspace…' : 'Create workspace'}
        </button>

        <p className="muted" style={{ marginTop: 14, textAlign: 'center' }}>
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
