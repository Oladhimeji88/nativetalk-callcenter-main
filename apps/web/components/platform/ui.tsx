'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { canPlatform, type PlatformCapability } from '@/lib/api';

/* Shared building blocks for the Platform Console, so every page reads the same. */

export const naira = (minor: number) => `₦${Math.round((minor ?? 0) / 100).toLocaleString()}`;
export const compactNaira = (minor: number) => {
  const n = Math.round((minor ?? 0) / 100);
  if (n >= 1_000_000) return `₦${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `₦${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return `₦${n.toLocaleString()}`;
};
export const num = (n: number) => (n ?? 0).toLocaleString();

export const when = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
export const day = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
export function ago(iso?: string | null) {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24); return d === 1 ? 'yesterday' : `${d}d ago`;
}

export function PageHead({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="ppage-head">
      <div>
        <h1 className="ppage-title">{title}</h1>
        {sub && <p className="ppage-sub">{sub}</p>}
      </div>
      {children && <div className="ppage-actions">{children}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, tone, Icon }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode;
  tone?: 'good' | 'bad' | 'warn'; Icon?: React.ComponentType<{ size?: number }>;
}) {
  return (
    <div className="pstat">
      <div className="pstat-top">
        <span className="pstat-label">{label}</span>
        {Icon && <span className="pstat-icon"><Icon size={16} /></span>}
      </div>
      <div className="pstat-value">{value}</div>
      {sub != null && <div className={`pstat-sub ${tone ? `is-${tone}` : ''}`}>{sub}</div>}
    </div>
  );
}

export function Panel({ title, sub, actions, children, flush }: {
  title: string; sub?: string; actions?: React.ReactNode; children: React.ReactNode; flush?: boolean;
}) {
  return (
    <section className="ppanel">
      <header className="ppanel-head">
        <div>
          <h2 className="ppanel-title">{title}</h2>
          {sub && <p className="ppanel-sub">{sub}</p>}
        </div>
        {actions}
      </header>
      <div className={flush ? '' : 'ppanel-body'}>{children}</div>
    </section>
  );
}

const STATUS_TONE: Record<string, string> = {
  active: 'good', operational: 'good', healthy: 'good', paid: 'good', published: 'good',
  trial: 'info', open: 'info', draft: 'muted', scheduled: 'info',
  past_due: 'bad', overdue: 'bad', suspended: 'bad', offline: 'bad', critical: 'bad',
  degraded: 'warn', draining: 'warn', warning: 'warn', high: 'bad', medium: 'warn', low: 'good',
};
const STATUS_LABEL: Record<string, string> = { past_due: 'past due', super_admin: 'Super Admin', platform_admin: 'Platform Admin' };

export function Chip({ value, dot = true }: { value: string; dot?: boolean }) {
  const key = String(value ?? '').toLowerCase();
  return (
    <span className={`pchip is-${STATUS_TONE[key] ?? 'muted'}`}>
      {dot && <span className="pchip-dot" />}
      {STATUS_LABEL[key] ?? value}
    </span>
  );
}

/** Usage bar — turns amber past 75% and red past 90% without being told. */
export function Meter({ value, max, label }: { value: number; max: number; label?: string }) {
  const pct = max ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const tone = pct >= 90 ? 'bad' : pct >= 75 ? 'warn' : 'good';
  return (
    <div className="pmeter">
      <div className="pmeter-track"><div className={`pmeter-fill is-${tone}`} style={{ width: `${pct}%` }} /></div>
      <span className="pmeter-label">{label ?? `${num(value)} / ${num(max)}`}</span>
    </div>
  );
}

export function Empty({ title, sub }: { title: string; sub?: string }) {
  return <div className="pempty"><p>{title}</p>{sub && <span>{sub}</span>}</div>;
}

export function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return <th className={right ? 'is-right' : ''}>{children}</th>;
}
export function Td({ children, right, colSpan }: { children?: React.ReactNode; right?: boolean; colSpan?: number }) {
  return <td colSpan={colSpan} className={right ? 'is-right' : ''}>{children}</td>;
}

export function Table({ head, children }: { head: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="ptable-wrap">
      <table className="ptable">
        <thead><tr>{head}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** Blocks a whole page unless the signed-in tier holds the capability. */
export function RequireCapability({ cap, children }: { cap: PlatformCapability; children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<'checking' | 'ok' | 'denied'>('checking');
  useEffect(() => { setState(canPlatform(cap) ? 'ok' : 'denied'); }, [cap]);

  if (state === 'checking') return null;
  if (state === 'denied') {
    return (
      <div className="pdenied">
        <h2>Super Admin only</h2>
        <p>
          This area controls pricing, infrastructure or console access, so it is limited to Super Admins.
          Ask one of them if you need a change here.
        </p>
        <button className="btn btn-green" onClick={() => router.push('/platform')}>Back to Overview</button>
      </div>
    );
  }
  return <>{children}</>;
}

/** Shows children only when the capability is held — for buttons inside a page. */
export function IfCapable({ cap, children }: { cap: PlatformCapability; children: React.ReactNode }) {
  const [ok, setOk] = useState(false);
  useEffect(() => { setOk(canPlatform(cap)); }, [cap]);
  return ok ? <>{children}</> : null;
}

/** Simple area chart used for revenue and volume trends. */
export function Trend({ data, valueKey = 'value', height = 150 }: { data: any[]; valueKey?: string; height?: number }) {
  const W = 560, H = height, P = 8;
  if (!data?.length) return <Empty title="No data yet" />;
  const vals = data.map((d) => d[valueKey] ?? 0);
  const max = Math.max(1, ...vals);
  const x = (i: number) => P + (i * (W - 2 * P)) / Math.max(1, data.length - 1);
  const y = (v: number) => H - 22 - (v / max) * (H - 40);
  const pts = data.map((d, i) => `${x(i)},${y(d[valueKey] ?? 0)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="ptrend" preserveAspectRatio="none">
      <defs>
        <linearGradient id="ptrend-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--green)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--green)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`${P},${H - 22} ${pts} ${x(data.length - 1)},${H - 22}`} fill="url(#ptrend-fill)" />
      <polyline points={pts} fill="none" stroke="var(--green)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      {data.map((d, i) => (
        i % Math.ceil(data.length / 7) === 0
          ? <text key={i} x={x(i)} y={H - 6} className="ptrend-label" textAnchor="middle">{d.label}</text>
          : null
      ))}
    </svg>
  );
}
