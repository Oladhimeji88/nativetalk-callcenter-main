// NativeTalk API client.
// Auth token is stored in an httpOnly cookie by the server — JavaScript never
// touches it. Non-sensitive profile info (name, role) is kept in localStorage
// for UI use only and is not trusted for access control decisions.
import { toast } from 'sonner';
import { installDemoBackend } from './demo';

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

// UI-only mode: answer API calls from local demo data. Installed at import time
// (this module is pulled in by every page) so it is in place before the first
// component effect fires. No-op unless NEXT_PUBLIC_DEMO_MODE=1.
installDemoBackend();

const SILENT_PATHS = ['/login', '/register']; // pages that handle errors inline

export async function api<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    credentials: 'include', // browser sends the httpOnly cookie automatically
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers ?? {}),
    },
  });
  if (res.status === 401 && typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
    clearProfile();
    window.location.href = '/login';
    throw new Error('Session expired — please sign in again');
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).message ?? msg; } catch { /* ignore */ }
    const message = Array.isArray(msg) ? msg.join(', ') : msg;
    const onSilentPage = typeof window !== 'undefined' &&
      SILENT_PATHS.some(p => window.location.pathname.startsWith(p));
    if (!onSilentPage) toast.error(message);
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// Profile helpers — name/roleName/permissions cached locally for display + menu
// gating. Permissions are re-checked server-side on every request.
function saveProfile(user: any) {
  if (typeof window === 'undefined') return;
  localStorage.setItem('nativetalk_super', user?.superAdmin ? '1' : '0');
  localStorage.setItem('nativetalk_user', JSON.stringify({
    email: user?.email,
    name: [user?.firstName, user?.lastName].filter(Boolean).join(' '),
    roleName: user?.roleName ?? null,
    tenant: user?.tenant,
    agentExtension: user?.agentExtension ?? null,
    superAdmin: !!user?.superAdmin,
    platformRole: user?.platformRole ?? null,
    permissions: user?.permissions ?? {},
  }));
}

function clearProfile() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('nativetalk_super');
  localStorage.removeItem('nativetalk_user');
  localStorage.removeItem(IMPERSONATION_KEY);
}

export async function login(email: string, password: string, rememberMe = false) {
  const r = await api<{ user?: any }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password, rememberMe }),
  });
  saveProfile(r.user);
  return r;
}

export async function logout() {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  clearProfile();
}

export interface SignupPlan {
  id: string;
  name: string;
  priceMonthly: number;
  currency: string;
  features: string[];
  limits: Record<string, number>;
}

export const signupPlans = () => api<SignupPlan[]>('/signup/plans');

export async function register(body: {
  company: string;
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  planId?: string;
}) {
  await api('/signup', { method: 'POST', body: JSON.stringify(body) });
  return login(body.email, body.password);
}

const readProfile = () => {
  if (typeof window === 'undefined') return null;
  try { return JSON.parse(localStorage.getItem('nativetalk_user') ?? 'null'); } catch { return null; }
};

/* ---------------------------------------------------------------------------
 * Impersonation — "view workspace as" a customer company.
 *
 * Support work needs to see exactly what the customer sees. Rather than swap
 * the signed-in profile (and lose the way back), the staff profile stays put
 * and the impersonated tenant is layered over it: getUser() reports the tenant
 * workspace, while getPlatformRole() still knows who is really driving.
 * ------------------------------------------------------------------------- */
const IMPERSONATION_KEY = 'nativetalk_impersonation';

export type Impersonation = { tenantId: string; tenantName: string; startedAt: string };

export function getImpersonation(): Impersonation | null {
  if (typeof window === 'undefined') return null;
  try { return JSON.parse(localStorage.getItem(IMPERSONATION_KEY) ?? 'null'); } catch { return null; }
}

export const isImpersonating = () => getImpersonation() !== null;

export function setImpersonation(v: Impersonation | null) {
  if (typeof window === 'undefined') return;
  if (v) localStorage.setItem(IMPERSONATION_KEY, JSON.stringify(v));
  else localStorage.removeItem(IMPERSONATION_KEY);
}

const TENANT_SECTIONS = [
  'softphone', 'contacts', 'live', 'queues', 'campaigns', 'recordings',
  'analytics', 'call_logs', 'pbx', 'users', 'billing', 'team',
];

export const getUser = () => {
  const base = readProfile();
  const imp = getImpersonation();
  if (!base || !imp) return base;
  return {
    ...base,
    tenant: imp.tenantName,
    roleName: 'Administrator',
    superAdmin: false, // inside the workspace, not above it
    permissions: Object.fromEntries(TENANT_SECTIONS.map((k) => [k, { enabled: true }])),
    impersonating: imp,
  };
};

export const isSuperAdmin = () => getUser()?.superAdmin === true;

/* ---------------------------------------------------------------------------
 * Platform (vendor-side) access
 *
 * Two populations use this app:
 *   • Tenant users  — staff at a customer company. Scoped to their workspace by
 *     the `permissions` map above.
 *   • Platform staff — our own people, working *above* every customer company
 *     in the Platform Console. Gated by `platformRole` instead.
 *
 * Platform tiers:
 *   super_admin    — owns the platform: pricing, revenue, infrastructure,
 *                    security, and the platform staff accounts themselves.
 *   platform_admin — runs customer operations: onboarding, support, suspend /
 *                    reactivate, usage. Cannot change pricing, infrastructure,
 *                    security policy, or other staff accounts.
 * ------------------------------------------------------------------------- */
export type PlatformRole = 'super_admin' | 'platform_admin';

export const PLATFORM_ROLE_LABEL: Record<PlatformRole, string> = {
  super_admin: 'Super Admin',
  platform_admin: 'Platform Admin',
};

export const getPlatformRole = (): PlatformRole | null => {
  const u = getUser();
  if (u?.platformRole === 'super_admin' || u?.platformRole === 'platform_admin') return u.platformRole;
  // Legacy profiles predate platformRole — treat the old superAdmin flag as the top tier.
  return u?.superAdmin ? 'super_admin' : null;
};

export const isPlatformStaff = () => getPlatformRole() !== null;

/** Every action the Platform Console can perform, and who may perform it. */
export type PlatformCapability =
  | 'tenants.view' | 'tenants.create' | 'tenants.manage' | 'tenants.delete' | 'tenants.impersonate'
  | 'plans.view' | 'plans.manage'
  | 'billing.view' | 'billing.manage'
  | 'staff.view' | 'staff.manage'
  | 'infrastructure.view' | 'infrastructure.manage'
  | 'audit.view'
  | 'announcements.manage'
  | 'settings.manage';

const SUPER_ONLY: PlatformCapability[] = [
  'tenants.delete', 'plans.manage', 'billing.manage',
  'staff.view', 'staff.manage', 'infrastructure.manage',
  'announcements.manage', 'settings.manage',
];

export function canPlatform(cap: PlatformCapability): boolean {
  const role = getPlatformRole();
  if (!role) return false;
  if (role === 'super_admin') return true;
  return !SUPER_ONLY.includes(cap);
}
// Whether the signed-in user's role grants a permission (superadmin always does).
// A role is just a permission group — "admin" is the group with everything on.
export const hasPermission = (section: string) => {
  if (isSuperAdmin()) return true;
  try { return !!getUser()?.permissions?.[section]?.enabled; } catch { return false; }
};

// Where to send the user after login. Platform staff belong in the console that
// sits above every customer company; tenant users get the first module their
// permissions grant.
export function landingPath(): string {
  if (isPlatformStaff() && !isImpersonating()) return '/platform';
  const order: [string, string][] = [
    ['analytics', '/dashboard'], ['softphone', '/agent'], ['contacts', '/contacts'],
    ['live', '/agents'], ['campaigns', '/campaigns'], ['recordings', '/recordings'],
    ['users', '/users'], ['pbx', '/trunks'], ['billing', '/billing'],
  ];
  for (const [perm, path] of order) if (hasPermission(perm)) return path;
  return '/agent';
}

// Re-fetch the current user's role + permissions from the server and update the
// cached profile. Login caches these, so a role/permission change an admin makes
// wouldn't otherwise show until the user logs out. Returns true if anything
// changed (caller can reload to apply it everywhere). Safe to call on every load.
export async function refreshProfile(): Promise<boolean> {
  try {
    // no-store: never serve a cached /auth/me, or a role/permission change won't
    // be seen until the browser cache expires.
    const me = await api<any>('/auth/me', { cache: 'no-store' });
    if (!me?.id) return false;
    const cur = getUser() || {};
    const changed =
      (me.roleName ?? null) !== (cur.roleName ?? null) ||
      !!me.superAdmin !== !!cur.superAdmin ||
      JSON.stringify(me.permissions ?? {}) !== JSON.stringify(cur.permissions ?? {});
    localStorage.setItem('nativetalk_super', me.superAdmin ? '1' : '0');
    localStorage.setItem('nativetalk_user', JSON.stringify({
      ...cur,
      email: me.email ?? cur.email,
      roleName: me.roleName ?? cur.roleName ?? null,
      agentExtension: me.agentExtension ?? cur.agentExtension ?? null,
      superAdmin: !!me.superAdmin,
      platformRole: me.platformRole ?? cur.platformRole ?? null,
      permissions: me.permissions ?? cur.permissions ?? {},
    }));
    return changed;
  } catch { return false; }
}
