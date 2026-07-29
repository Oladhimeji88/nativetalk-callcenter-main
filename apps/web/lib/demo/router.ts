// Demo-mode request router.
//
// Maps every REST call the UI makes onto the in-memory demo database. Reads are
// derived on the fly (counts, KPIs, joins) and writes mutate the store, so the
// CRUD screens behave like the real thing — create a campaign, edit a queue,
// delete a contact and it stays until the demo data is reset.

import { db, save, uid, DEMO_USER, pick } from './data';

type Handler = (ctx: Ctx) => any;
type Ctx = { method: string; path: string; query: URLSearchParams; body: any; params: string[] };

const HOUR = 3600_000, DAY = 24 * HOUR;

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// ---------------------------------------------------------------- helpers

const list = (name: string): any[] => db()[name] as any[];
const byId = (name: string, id: string) => list(name).find((x) => x.id === id);
const remove = (name: string, id: string) => {
  const arr = list(name);
  const i = arr.findIndex((x) => x.id === id);
  if (i >= 0) arr.splice(i, 1);
  save();
};
const patch = (name: string, id: string, body: any) => {
  const row = byId(name, id);
  if (!row) throw new HttpError(404, 'Not found');
  Object.assign(row, body, { id });
  save();
  return row;
};
const create = (name: string, prefix: string, body: any, extra: any = {}) => {
  const row = { id: uid(prefix), createdAt: new Date().toISOString(), ...body, ...extra };
  list(name).unshift(row);
  save();
  return row;
};

// Build the signed-in profile for a demo account, with the permission set its
// role grants — this is what drives the sidebar, route guards and role badge,
// so signing in as different accounts shows genuinely different apps.
function profileFor(email: string) {
  const needle = email.toLowerCase();

  // Platform staff first: they work above every tenant and have no workspace.
  const staff = list('platformStaff').find((s) => String(s.email).toLowerCase() === needle);
  if (staff) {
    if (!staff.active) throw new HttpError(403, 'This platform account has been disabled');
    patch('platformStaff', staff.id, { lastSeenAt: new Date().toISOString() });
    return {
      id: staff.id,
      email: staff.email,
      firstName: staff.firstName,
      lastName: staff.lastName,
      title: staff.title,
      roleName: staff.platformRole === 'super_admin' ? 'Super Admin' : 'Platform Admin',
      platformRole: staff.platformRole,
      superAdmin: staff.platformRole === 'super_admin',
      agentExtension: null,
      tenant: 'NativeTalk Platform',
      permissions: {},
    };
  }

  const acc = list('accounts').find((a) => String(a.email).toLowerCase() === needle);
  if (!acc) return { ...DEMO_USER, email }; // unknown email — let them into the demo workspace
  const role = byId('roles', acc.roleId);
  return {
    id: acc.id,
    email: acc.email,
    firstName: acc.firstName,
    lastName: acc.lastName,
    roleName: acc.roleName,
    platformRole: null,
    agentExtension: acc.agentExtension,
    superAdmin: false,
    tenant: 'NativeTalk Demo',
    permissions: role?.permissions ?? {},
  };
}

const currentUser = () => db().session ?? DEMO_USER;

// A value that drifts with the clock, so polled screens visibly update.
const drift = (base: number, spread: number, period = 20_000) =>
  Math.max(0, Math.round(base + Math.sin(Date.now() / period) * spread));

const groupWithCounts = () =>
  list('groups').map((g) => ({ ...g, count: list('contacts').filter((c) => (c.groupIds ?? []).includes(g.id)).length }));

const campaignOverview = () => list('campaigns').map((c) => {
  const leads = list('leads').filter((l) => l.campaignId === c.id);
  const done = leads.filter((l) => l.status === 'done').length;
  const runs = list('runs').filter((r) => r.campaignId === c.id);
  const bridged = runs.reduce((s, r) => s + (r.bridged || 0), 0);
  const abandoned = runs.reduce((s, r) => s + (r.abandoned || 0), 0);
  return {
    ...c,
    contactsCount: leads.length,
    agentCount: (c.assignedAgentIds ?? []).length,
    contactRate: leads.length ? Math.round((done / leads.length) * 100) : 0,
    abandonRate: bridged + abandoned ? Math.round((abandoned / (bridged + abandoned)) * 1000) / 10 : 0,
    runCount: runs.length,
  };
});

// Live agent board: extension, presence, and today's workload per account.
const telephonyAgents = () => list('accounts').filter((a) => a.agentExtension).map((a, i) => {
  const states = ['on-call', 'available', 'wrap-up', 'available', 'away', 'on-call', 'available', 'offline'];
  const logs = list('callLogs').filter((l) => l.agentExt === a.agentExtension);
  const conn = logs.filter((l) => l.status === 'completed').length;
  const talk = logs.reduce((s, l) => s + (l.durationSec || 0), 0);
  const aht = conn ? Math.round(talk / conn) : 0;
  return {
    extension: a.agentExtension,
    name: `${a.firstName} ${a.lastName}`,
    state: a.active ? states[(i + Math.floor(Date.now() / 30_000)) % states.length] : 'offline',
    calls: logs.length,
    connected: conn,
    aht: `${Math.floor(aht / 60)}:${String(aht % 60).padStart(2, '0')}`,
  };
});

const dashboard = (range: string) => {
  const windowMs = range === '1h' ? HOUR : range === '7d' ? 7 * DAY : range === '30d' ? 30 * DAY : DAY;
  const since = Date.now() - windowMs;
  const logs = list('callLogs').filter((l) => +new Date(l.startedAt) >= since);
  const answered = logs.filter((l) => l.status === 'completed');
  const agents = telephonyAgents();
  const onCall = agents.filter((a) => a.state === 'on-call');
  const talk = answered.reduce((s, l) => s + (l.durationSec || 0), 0);

  const liveCalls = onCall.map((a, i) => ({
    caller: list('contacts')[(i * 5 + Math.floor(Date.now() / 60_000)) % list('contacts').length].phone,
    agent: a.name,
    campaign: list('campaigns')[i % list('campaigns').length].name,
    queue: list('queues')[i % list('queues').length].name,
    durationSec: drift(120 + i * 40, 60, 8000),
    status: i % 3 === 2 ? 'on-hold' : 'connected',
  }));

  const days = 14;
  const contactRateSeries = Array.from({ length: days }, (_, i) => {
    const d = new Date(Date.now() - (days - 1 - i) * DAY);
    return { label: `${d.getDate()}/${d.getMonth() + 1}`, rate: 30 + Math.round(20 * Math.abs(Math.sin(i * 1.1))) };
  });

  return {
    kpis: {
      activeCalls: liveCalls.length,
      agentsAvailable: agents.filter((a) => a.state === 'available').length,
      agentsTotal: agents.length,
      calls: logs.length,
      callsDelta: 12,
      contactRate: logs.length ? Math.round((answered.length / logs.length) * 100) : 0,
      contactRateDelta: 3,
      avgHandleSec: answered.length ? Math.round(talk / answered.length) : 0,
      avgHandleDelta: -8,
      callsWaiting: list('queues').reduce((s, q) => s + (q.waiting || 0), 0),
    },
    liveCalls,
    agents: agents.map((a) => ({ ext: a.extension, name: a.name, status: a.state })),
    contactRateSeries,
    campaignPerformance: campaignOverview().map((c) => ({ name: c.name, rate: c.contactRate })),
  };
};

/* ---------------------------------------------------------------------------
 * Company Admin dashboard — the health of one workspace: seats and channels
 * against the plan, what the team costs, what needs attention.
 * ------------------------------------------------------------------------- */
const adminDashboard = () => {
  const accounts = list('accounts');
  const plan = list('plans')[1];
  const logs = list('callLogs');
  const answered = logs.filter((l) => l.status === 'completed');
  const talk = answered.reduce((s, l) => s + (l.durationSec || 0), 0);
  const agents = telephonyAgents();
  const openInvoice = list('invoices').find((i) => i.status === 'open' || i.status === 'overdue');
  const campaigns = campaignOverview();

  const attention: any[] = [];
  const seatsUsed = accounts.filter((a) => a.agentExtension).length;
  if (seatsUsed / plan.limits.maxExtensions > 0.8) {
    attention.push({ severity: 'warning', title: 'Approaching your extension limit', detail: `${seatsUsed} of ${plan.limits.maxExtensions} extensions in use.`, href: '/billing' });
  }
  for (const q of list('queues').filter((q) => String(q.health).toLowerCase() === 'overloaded')) {
    attention.push({ severity: 'critical', title: `${q.name} queue is overloaded`, detail: `${q.waiting} callers waiting.`, href: '/queues' });
  }
  for (const a of accounts.filter((a) => !a.active)) {
    attention.push({ severity: 'info', title: `${a.firstName} ${a.lastName} is disabled`, detail: 'Account cannot sign in. Re-enable or remove the seat.', href: '/users' });
  }
  if (openInvoice) {
    attention.push({ severity: openInvoice.status === 'overdue' ? 'critical' : 'info', title: openInvoice.status === 'overdue' ? 'Invoice overdue' : 'Invoice awaiting payment', detail: `${fmtNaira(openInvoice.amount)} · ${openInvoice.period ?? ''}`, href: '/billing' });
  }
  for (const t of list('trunks').filter((t) => t.active === false)) {
    attention.push({ severity: 'warning', title: `Trunk ${t.name} is paused`, detail: 'Outbound calls will not route through it.', href: '/trunks' });
  }

  return {
    workspace: {
      name: currentUser().tenant ?? 'Workspace',
      plan: plan.name,
      status: 'active',
      renewsAt: new Date(Date.now() + 12 * DAY).toISOString(),
    },
    seats: { used: seatsUsed, limit: plan.limits.maxExtensions },
    channels: { peak: Math.max(...agents.map(() => 0), Math.round(agents.length * 0.7)), limit: plan.limits.maxConcurrentCalls },
    campaignQuota: { used: campaigns.length, limit: plan.limits.maxCampaigns },
    spend: { thisMonth: plan.priceMonthly, currency: 'NGN', invoiceStatus: openInvoice?.status ?? 'paid' },
    kpis: {
      calls: logs.length,
      contactRate: logs.length ? Math.round((answered.length / logs.length) * 100) : 0,
      avgHandleSec: answered.length ? Math.round(talk / answered.length) : 0,
      agentsOnline: agents.filter((a) => a.state !== 'offline').length,
      agentsTotal: agents.length,
      queuesWaiting: list('queues').reduce((s, q) => s + (q.waiting || 0), 0),
      recordingHours: Math.round(logs.filter((l) => l.recording).reduce((s, l) => s + (l.durationSec || 0), 0) / 360) / 10,
    },
    team: accounts.map((a) => ({
      id: a.id,
      name: `${a.firstName} ${a.lastName}`,
      role: a.roleName,
      ext: a.agentExtension,
      active: a.active,
      status: agents.find((x) => x.extension === a.agentExtension)?.state ?? 'offline',
    })),
    campaigns: campaigns.map((c) => ({ id: c.id, name: c.name, active: c.active, dialMethod: c.dialMethod, contactRate: c.contactRate, contactsCount: c.contactsCount })),
    queues: list('queues').map((q) => ({ id: q.id, name: q.name, waiting: q.waiting, health: q.health, slaTargetPct: q.slaTargetPct, membersCount: q.membersCount })),
    trunks: list('trunks').map((t) => ({ id: t.id, name: t.name, active: t.active !== false, proxy: t.proxy })),
    callsSeries: Array.from({ length: 14 }, (_, i) => {
      const d = new Date(Date.now() - (13 - i) * DAY);
      return { label: `${d.getDate()}/${d.getMonth() + 1}`, calls: 40 + Math.round(30 * Math.abs(Math.sin(i * 0.9))) };
    }),
    attention,
  };
};

/* ---------------------------------------------------------------------------
 * Agent dashboard — one person's own day. No workspace-wide figures.
 * ------------------------------------------------------------------------- */
const agentDashboard = () => {
  const me = currentUser();
  const ext = me.agentExtension;
  const mine = list('callLogs').filter((l) => l.agentExt === ext);
  const answered = mine.filter((l) => l.status === 'completed');
  const talk = answered.reduce((s, l) => s + (l.durationSec || 0), 0);

  const counts = new Map<string, number>();
  for (const l of mine) if (l.disposition) counts.set(l.disposition, (counts.get(l.disposition) ?? 0) + 1);
  const dispositionBreakdown = [...counts.entries()]
    .map(([name, count]) => ({ name, count, category: list('dispositions').find((d) => d.name === name)?.category ?? 'Neutral' }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const leaderboard = telephonyAgents()
    .map((a) => ({ name: a.name, ext: a.extension, connected: a.connected }))
    .sort((a, b) => b.connected - a.connected);

  const callbacks = list('callLogs')
    .filter((l) => l.agentExt === ext && /callback/i.test(l.disposition ?? ''))
    .slice(0, 5)
    .map((l) => ({ id: l.id, name: l.contactName ?? l.peerNumber, phone: l.peerNumber, at: l.startedAt }));

  const target = 40;
  return {
    agent: { name: `${me.firstName} ${me.lastName}`, ext, status: telephonyAgents().find((a) => a.extension === ext)?.state ?? 'offline' },
    today: {
      calls: mine.length,
      connected: answered.length,
      talkSec: talk,
      avgHandleSec: answered.length ? Math.round(talk / answered.length) : 0,
      contactRate: mine.length ? Math.round((answered.length / mine.length) * 100) : 0,
      missed: mine.filter((l) => l.status === 'missed').length,
    },
    goal: { target, achieved: answered.length, pct: Math.min(100, Math.round((answered.length / target) * 100)) },
    hourly: Array.from({ length: 9 }, (_, i) => ({ label: `${9 + i}:00`, calls: Math.max(0, Math.round(6 * Math.abs(Math.sin(i * 0.8 + 1)))) })),
    dispositionBreakdown,
    recent: mine.slice(0, 8),
    callbacks,
    campaigns: campaignOverview().filter((c) => (c.assignedAgentIds ?? []).some((id: string) => list('accounts').find((a) => a.id === id)?.agentExtension === ext))
      .map((c) => ({ id: c.id, name: c.name, dialMethod: c.dialMethod, contactRate: c.contactRate })),
    ranking: {
      position: Math.max(1, leaderboard.findIndex((a) => a.ext === ext) + 1),
      of: leaderboard.length,
      leaderboard: leaderboard.slice(0, 5),
    },
  };
};

/* ---------------------------------------------------------------------------
 * Platform Console helpers
 * ------------------------------------------------------------------------- */
const fmtNaira = (minor: number) => `NGN ${Math.round((minor ?? 0) / 100).toLocaleString()}`;

/** Append an audit entry attributed to whoever is signed in. */
function audit(action: string, target: string, severity: 'info' | 'warning' | 'critical' = 'info') {
  const u = currentUser();
  list('auditLog').unshift({
    id: uid('aud'),
    at: new Date().toISOString(),
    actorName: `${u.firstName} ${u.lastName}`,
    actorEmail: u.email,
    actorRole: u.platformRole ?? 'tenant_user',
    action, target, severity,
    ip: '102.89.14.7',
  });
  save();
}

const pct = (used: number, limit: number) => (limit ? Math.min(999, Math.round((used / limit) * 100)) : 0);

/** Add the utilisation figures every tenant view needs. */
function withTenantDerived(t: any) {
  const limits = t.limits ?? {};
  const daysLeft = t.trialEndsAt
    ? Math.ceil((new Date(t.trialEndsAt).getTime() - Date.now()) / DAY)
    : null;
  return {
    ...t,
    seatUsagePct: pct(t.usage?.extensions ?? 0, limits.maxExtensions ?? 0),
    channelUsagePct: pct(t.usage?.concurrentPeak ?? 0, limits.maxConcurrentCalls ?? 0),
    minuteUsagePct: pct(t.usage?.minutesThisMonth ?? 0, limits.maxMinutesPerMonth ?? 0),
    trialDaysLeft: daysLeft,
    openInvoiceTotal: list('invoices')
      .filter((i) => i.tenantId === t.id && i.status !== 'paid')
      .reduce((s, i) => s + (i.amount || 0), 0),
  };
}

function revenueTotals() {
  const tenants = list('tenants');
  const mrr = tenants.reduce((s, t) => s + (t.mrr || 0), 0);
  const series = db().revenueSeries ?? [];
  const prev = series.length > 1 ? series[series.length - 2].mrr : mrr;
  const outstanding = list('invoices').filter((i) => i.status !== 'paid').reduce((s, i) => s + (i.amount || 0), 0);
  return {
    mrr,
    arr: mrr * 12,
    growthPct: prev ? Math.round(((mrr - prev) / prev) * 1000) / 10 : 0,
    churnPct: series.length ? Math.round((series[series.length - 1].churnedMrr / Math.max(1, series[series.length - 1].mrr)) * 1000) / 10 : 0,
    outstanding,
    overdueCount: list('invoices').filter((i) => i.status === 'overdue').length,
  };
}

/**
 * The console's landing payload. Returns the full picture; the page shows only
 * the parts the signed-in tier is allowed to see.
 */
function platformOverview() {
  const tenants = list('tenants').map(withTenantDerived);
  const nodes = db().nodes ?? [];
  const services = db().services ?? [];
  const channelsUsed = nodes.reduce((s: number, n: any) => s + n.channelsUsed, 0);
  const channelCapacity = nodes.reduce((s: number, n: any) => s + n.channelCapacity, 0);

  // The work queue: everything a human needs to look at, most urgent first.
  const attention: any[] = [];
  for (const t of tenants) {
    if (t.status === 'past_due') {
      attention.push({ id: `att_pd_${t.id}`, severity: 'critical', tenantId: t.id, tenantName: t.name, title: 'Payment overdue', detail: `${fmtNaira(t.openInvoiceTotal)} outstanding · ${t.notes || 'no note'}`, action: 'Chase payment', href: '/platform/billing' });
    }
    if (t.status === 'trial' && (t.trialDaysLeft ?? 99) <= 5) {
      attention.push({ id: `att_tr_${t.id}`, severity: 'warning', tenantId: t.id, tenantName: t.name, title: `Trial ends in ${Math.max(0, t.trialDaysLeft)} day${t.trialDaysLeft === 1 ? '' : 's'}`, detail: `${t.usage.agents} agents active · started on ${t.plan}`, action: 'Convert to paid', href: '/platform/tenants' });
    }
    if (t.seatUsagePct >= 90 && t.status !== 'suspended') {
      attention.push({ id: `att_seat_${t.id}`, severity: 'warning', tenantId: t.id, tenantName: t.name, title: 'At extension limit', detail: `${t.usage.extensions} of ${t.limits.maxExtensions} used — upsell opportunity`, action: 'Suggest upgrade', href: '/platform/tenants' });
    }
    if (t.churnRisk === 'high' && t.status !== 'suspended') {
      attention.push({ id: `att_churn_${t.id}`, severity: 'warning', tenantId: t.id, tenantName: t.name, title: 'High churn risk', detail: `Health ${t.healthScore}/100 · last active ${new Date(t.lastActivityAt).toLocaleDateString()}`, action: 'Reach out', href: '/platform/tenants' });
    }
  }
  for (const n of nodes.filter((n: any) => n.status === 'degraded')) {
    attention.push({ id: `att_node_${n.id}`, severity: 'critical', title: `${n.name} is degraded`, detail: `${n.channelsUsed}/${n.channelCapacity} channels · CPU ${n.cpuPct}%`, action: 'Inspect node', href: '/platform/infrastructure', scope: 'infrastructure' });
  }
  for (const s of services.filter((s: any) => s.status !== 'operational')) {
    attention.push({ id: `att_svc_${s.id}`, severity: 'warning', title: `${s.name} degraded`, detail: s.detail, action: 'Inspect', href: '/platform/infrastructure', scope: 'infrastructure' });
  }
  const rank = { critical: 0, warning: 1, info: 2 } as Record<string, number>;
  attention.sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3));

  const monthAgo = Date.now() - 30 * DAY;
  return {
    tenants: {
      total: tenants.length,
      active: tenants.filter((t) => t.status === 'active').length,
      trial: tenants.filter((t) => t.status === 'trial').length,
      pastDue: tenants.filter((t) => t.status === 'past_due').length,
      suspended: tenants.filter((t) => t.status === 'suspended').length,
      newThisMonth: tenants.filter((t) => +new Date(t.createdAt) >= monthAgo).length,
    },
    revenue: revenueTotals(),
    revenueSeries: db().revenueSeries,
    usage: {
      agents: tenants.reduce((s, t) => s + (t.usage?.agents ?? 0), 0),
      extensions: tenants.reduce((s, t) => s + (t.usage?.extensions ?? 0), 0),
      callsThisPeriod: tenants.reduce((s, t) => s + (t.usage?.callsThisPeriod ?? 0), 0),
      minutesThisPeriod: tenants.reduce((s, t) => s + (t.usage?.minutesThisMonth ?? 0), 0),
    },
    capacity: {
      channelsUsed, channelCapacity,
      utilisationPct: pct(channelsUsed, channelCapacity),
      nodesHealthy: nodes.filter((n: any) => n.status === 'healthy').length,
      nodesTotal: nodes.length,
    },
    services,
    attention,
    trialsEnding: tenants.filter((t) => t.status === 'trial').sort((a, b) => (a.trialDaysLeft ?? 0) - (b.trialDaysLeft ?? 0)),
    topTenants: tenants.slice().sort((a, b) => (b.mrr || 0) - (a.mrr || 0)).slice(0, 6),
    recentActivity: list('auditLog').slice(0, 8),
    staffCount: list('platformStaff').filter((s) => s.active).length,
  };
}

// Realtime snapshot pushed to the Live Dashboard in place of the Socket.io feed.
export function realtimeSnapshot() {
  const agents = telephonyAgents();
  const onCall = agents.filter((a) => a.state === 'on-call');
  return {
    activeCalls: onCall.length,
    summary: {
      agentsAvailable: agents.filter((a) => a.state === 'available').length,
      agentsOnCall: onCall.length,
      agentsOnBreak: agents.filter((a) => a.state === 'away').length,
    },
    agents: agents.map((a) => ({ name: a.name, status: a.state, state: a.state, callsAnswered: a.connected, talkTime: a.calls * 47 })),
    calls: onCall.map((a, i) => ({
      uuid: `uuid-demo-${a.extension}`,
      cid_num: list('contacts')[(i * 3) % list('contacts').length].phone,
      dest: a.extension,
      direction: i % 2 ? 'inbound' : 'outbound',
    })),
    campaigns: campaignOverview().filter((c) => c.active && c.dialMethod !== 'Preview').map((c) => ({
      campaignId: c.id, name: c.name, mode: c.dialMethod, status: 'running',
      answered: drift(40, 8), failed: drift(12, 4), pending: drift(60, 10),
    })),
  };
}

// Preview dialing: hand out the next open lead for a campaign.
const nextLead = (cid: string) => {
  const campaign = byId('campaigns', cid);
  if (!campaign) throw new HttpError(404, 'Campaign not found');
  const leads = list('leads').filter((l) => l.campaignId === cid);
  const lead = leads.find((l) => l.status === 'open');
  const contact = lead ? list('contacts').find((c) => c.id === lead.contactId) : null;
  return {
    campaign: { id: campaign.id, name: campaign.name, recording: campaign.recording, dispositionIds: campaign.dispositionIds ?? [] },
    lead: lead ? { id: lead.id, phone: lead.phone, name: lead.name } : null,
    contact,
    done: !lead,
    total: leads.length,
  };
};

// ---------------------------------------------------------------- routes
// Matched in order; `*` captures one path segment into ctx.params.

const ROUTES: [string, string, Handler][] = [
  // ----- auth / signup
  ['POST', '/auth/login', ({ body }) => {
    if (!body?.email || !body?.password) throw new HttpError(400, 'Email and password are required');
    const user = profileFor(String(body.email).trim());
    db().session = user;
    save();
    return { user };
  }],
  ['POST', '/auth/logout', () => { db().session = null; save(); return null; }],
  ['GET', '/auth/me', () => currentUser()],
  ['GET', '/signup/plans', () => list('plans')],
  ['POST', '/signup', () => ({ ok: true })],

  // ----- dashboards (one per role profile)
  ['GET', '/dashboard/ops', ({ query }) => dashboard(query.get('range') ?? '24h')],
  ['GET', '/dashboard/admin', () => adminDashboard()],
  ['GET', '/dashboard/me', () => agentDashboard()],

  // ----- telephony
  ['GET', '/telephony/agents', () => telephonyAgents()],
  ['POST', '/telephony/agents/*/monitor', () => ({ ok: true })],
  ['POST', '/telephony/agents/*/status', () => ({ ok: true })],
  ['POST', '/telephony/calls/*/monitor', () => ({ ok: true })],
  ['POST', '/telephony/record/start', () => ({ recording: 'demo-recording.wav' })],
  ['GET', '/telephony/softphone', ({ query }) => ({
    extension: query.get('extension') ?? '1001',
    uri: `sip:${query.get('extension') ?? '1001'}@demo.nativetalk.local`,
    wsServer: 'wss://demo.nativetalk.local:7443',
    sipDomain: 'demo.nativetalk.local',
    password: 'demo', displayName: 'Demo Agent', iceServers: [],
  })],

  // ----- call logs
  ['GET', '/call-logs', ({ query }) => {
    let rows = list('callLogs');
    const peer = query.get('peer');
    if (peer) rows = rows.filter((r) => (query.get('exact') ? r.peerNumber === peer : String(r.peerNumber).includes(peer)));
    if (query.get('hasRecording')) rows = rows.filter((r) => !!r.recording);
    return rows.slice(0, Number(query.get('limit') ?? 500));
  }],
  ['POST', '/call-logs', ({ body }) => create('callLogs', 'log', {
    agentExt: currentUser().agentExtension,
    agentName: `${currentUser().firstName} ${currentUser().lastName}`,
    contactName: list('contacts').find((c) => c.phone === body?.peerNumber)?.name ?? null,
    campaignName: byId('campaigns', body?.campaignId ?? '')?.name ?? null,
    recording: null, fields: [],
    ...body,
    startedAt: body?.startedAt ?? new Date().toISOString(),
  })],
  ['PATCH', '/call-logs/*', ({ params, body }) => patch('callLogs', params[0], body)],
  ['DELETE', '/call-logs/*/recording', ({ params }) => { patch('callLogs', params[0], { recording: null }); return null; }],

  // ----- contacts
  ['GET', '/contacts/lookup', ({ query }) => list('contacts').find((c) => c.phone === query.get('phone')) ?? null],
  ['POST', '/contacts/import', ({ body }) => {
    const rows = body?.contacts ?? [];
    let createdGroups = 0;
    for (const r of rows) {
      const groupIds: string[] = body?.groupId ? [body.groupId] : [];
      if (r.group) {
        let g = list('groups').find((x) => x.name.toLowerCase() === String(r.group).toLowerCase());
        if (!g) { g = { id: uid('grp'), name: r.group }; list('groups').push(g); createdGroups++; }
        groupIds.push(g.id);
      }
      list('contacts').unshift({
        id: uid('con'), name: r.name, phone: r.phone, email: r.email, company: r.company,
        notes: '', groupIds, customFields: r.customFields ?? {}, lastContactedAt: null, lastDisposition: null,
      });
    }
    save();
    return { created: rows.length, createdGroups };
  }],
  ['GET', '/contacts', ({ query }) => {
    const g = query.get('group');
    return g ? list('contacts').filter((c) => (c.groupIds ?? []).includes(g)) : list('contacts');
  }],
  ['POST', '/contacts', ({ body }) => create('contacts', 'con', {
    groupIds: [], customFields: {}, lastContactedAt: null, lastDisposition: null, ...body,
  })],
  ['GET', '/contacts/*', ({ params }) => byId('contacts', params[0]) ?? null],
  ['PATCH', '/contacts/*', ({ params, body }) => patch('contacts', params[0], body)],
  ['DELETE', '/contacts/*', ({ params }) => { remove('contacts', params[0]); return null; }],

  ['GET', '/contact-groups', () => groupWithCounts()],
  ['POST', '/contact-groups', ({ body }) => create('groups', 'grp', body)],
  ['DELETE', '/contact-groups/*', ({ params }) => {
    remove('groups', params[0]);
    list('contacts').forEach((c) => { c.groupIds = (c.groupIds ?? []).filter((g: string) => g !== params[0]); });
    save();
    return null;
  }],

  ['GET', '/custom-fields', () => list('customFields')],
  ['POST', '/custom-fields', ({ body }) => create('customFields', 'cf', {
    ...body, key: String(body?.label ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_'),
  })],
  ['DELETE', '/custom-fields/*', ({ params }) => { remove('customFields', params[0]); return null; }],

  // ----- campaigns (specific paths before the /* fallbacks)
  ['GET', '/campaigns/overview', () => campaignOverview()],
  ['GET', '/campaigns/mine', () => campaignOverview().filter((c) => c.active && /preview/i.test(c.dialMethod))],
  ['GET', '/campaigns/joinable', () => campaignOverview().filter((c) => c.active && !/preview/i.test(c.dialMethod))],
  ['GET', '/campaigns/joined', () => ({ campaignId: db().joined.campaignId })],
  ['POST', '/campaigns', ({ body }) => create('campaigns', 'cmp', { active: true, assignedAgentIds: [], ...body })],

  ['GET', '/campaigns/*/runs/*/calls', ({ params }) => ({
    run: byId('runs', params[1]),
    items: list('runCalls').filter((c) => c.runId === params[1]),
  })],
  ['GET', '/campaigns/*/runs', ({ params }) => list('runs').filter((r) => r.campaignId === params[0])],
  ['GET', '/campaigns/*/calls', ({ params }) => {
    const c = byId('campaigns', params[0]);
    const calls = list('callLogs').filter((l) => l.campaignId === params[0]).map((l) => ({
      id: l.id, kind: 'log', startedAt: l.startedAt, number: l.peerNumber, name: l.contactName,
      agent: l.agentName, durationSec: l.durationSec, status: l.status, cause: l.disconnectedBy ? 'NORMAL_CLEARING' : '',
      disposition: l.disposition, notes: l.notes, recording: l.recording,
    }));
    return {
      campaign: { id: c?.id, name: c?.name },
      counts: {
        total: calls.length,
        answered: calls.filter((x) => x.status === 'completed').length,
        dispositioned: calls.filter((x) => x.disposition).length,
        recorded: calls.filter((x) => x.recording).length,
      },
      calls,
    };
  }],
  ['GET', '/campaigns/*/run', ({ params }) => {
    const leads = list('leads').filter((l) => l.campaignId === params[0]);
    const t = Math.floor(Date.now() / 4000);
    return {
      status: 'running',
      ratio: 2.1,
      bridged: drift(40, 6),
      abandoned: drift(3, 2),
      joinedAgents: ['1002', '1005'],
      items: leads.slice(0, 20).map((l, i) => ({
        number: l.phone,
        status: i < (t % 20) ? pick(['answered', 'failed', 'answered']) : i === (t % 20) ? 'dialing' : 'queued',
        attempts: l.attempts || 1,
        disposition: l.disposition,
        cause: i % 4 === 3 ? 'USER_BUSY' : 'NORMAL_CLEARING',
      })),
    };
  }],
  ['GET', '/campaigns/*/participation', ({ params }) => {
    const leads = list('leads').filter((l) => l.campaignId === params[0]);
    const done = leads.filter((l) => l.status === 'done').length;
    return {
      joined: db().joined.campaignId === params[0],
      status: 'running',
      pulse: { status: 'running', remaining: leads.length - done, done, agentsOn: 2, dialing: drift(1, 1, 12_000) },
    };
  }],
  ['POST', '/campaigns/*/join', ({ params }) => { db().joined.campaignId = params[0]; save(); return { ok: true }; }],
  ['POST', '/campaigns/*/leave', () => { db().joined.campaignId = null; save(); return { ok: true }; }],
  ['POST', '/campaigns/*/duplicate', ({ params }) => {
    const c = byId('campaigns', params[0]);
    if (!c) throw new HttpError(404, 'Campaign not found');
    const copy = { ...c, id: uid('cmp'), name: `${c.name} (copy)`, active: false, createdAt: new Date().toISOString() };
    list('campaigns').unshift(copy);
    list('leads').filter((l) => l.campaignId === c.id).forEach((l, i) =>
      list('leads').push({ ...l, id: `${copy.id}_${i}`, campaignId: copy.id, status: 'open', disposition: null, attempts: 0 }));
    save();
    return copy;
  }],
  ['POST', '/campaigns/*/reset', ({ params }) => {
    list('leads').filter((l) => l.campaignId === params[0])
      .forEach((l) => { l.status = 'open'; l.disposition = null; l.attempts = 0; });
    save();
    return { ok: true };
  }],
  ['GET', '/campaigns/*/preview/next', ({ params }) => nextLead(params[0])],
  ['POST', '/campaigns/*/preview/skip', ({ body }) => {
    const l = list('leads').find((x) => x.id === body?.leadId);
    if (l) { l.status = 'done'; l.disposition = 'Skipped'; save(); }
    return { ok: true };
  }],
  ['POST', '/campaigns/*/preview/log', ({ params, body }) => create('callLogs', 'log', {
    direction: 'outbound',
    agentExt: currentUser().agentExtension,
    agentName: `${currentUser().firstName} ${currentUser().lastName}`,
    campaignId: params[0],
    campaignName: byId('campaigns', params[0])?.name ?? null,
    contactName: list('contacts').find((c) => c.phone === body?.peerNumber)?.name ?? null,
    fields: [],
    ...body,
    startedAt: body?.startedAt ?? new Date().toISOString(),
  })],
  ['POST', '/campaigns/*/preview/disposition', ({ body }) => {
    const l = list('leads').find((x) => x.id === body?.leadId);
    if (l) { l.status = 'done'; l.disposition = body?.disposition ?? null; l.attempts = (l.attempts || 0) + 1; }
    if (body?.logId) { const log = byId('callLogs', body.logId); if (log) Object.assign(log, { disposition: body?.disposition, notes: body?.notes }); }
    save();
    return { ok: true };
  }],
  ['POST', '/campaigns/*/disposition', ({ body }) => {
    const l = list('leads').find((x) => x.phone === body?.number);
    if (l) { l.disposition = body?.disposition; save(); }
    return { ok: true };
  }],
  ['POST', '/campaigns/*/call-disposition', () => ({ ok: true })],
  ['PATCH', '/campaigns/*', ({ params, body }) => patch('campaigns', params[0], body)],
  ['DELETE', '/campaigns/*', ({ params }) => { remove('campaigns', params[0]); return null; }],

  // ----- dispositions
  ['GET', '/dispositions', () => list('dispositions')],
  ['POST', '/dispositions', ({ body }) => create('dispositions', 'dsp', { active: true, isSystem: false, ...body })],
  ['PATCH', '/dispositions/*', ({ params, body }) => patch('dispositions', params[0], body)],
  ['DELETE', '/dispositions/*', ({ params }) => { remove('dispositions', params[0]); return null; }],

  // ----- PBX
  ['GET', '/pbx/queues', () => list('queues')],
  ['POST', '/pbx/queues', ({ body }) => create('queues', 'que', {
    number: String(8000 + list('queues').length + 1), waiting: 0, avgWaitSec: 0, health: 'Healthy',
    ...body, membersCount: (body?.members ?? []).length,
  })],
  ['PATCH', '/pbx/queues/*', ({ params, body }) => patch('queues', params[0], { ...body, membersCount: (body?.members ?? []).length })],
  ['DELETE', '/pbx/queues/*', ({ params }) => { remove('queues', params[0]); return null; }],

  ['GET', '/pbx/trunks', () => list('trunks')],
  ['POST', '/pbx/trunks', ({ body }) => create('trunks', 'trk', { provider: null, ...body })],
  ['PATCH', '/pbx/trunks/*', ({ params, body }) => patch('trunks', params[0], body)],
  ['DELETE', '/pbx/trunks/*', ({ params }) => { remove('trunks', params[0]); return null; }],

  // ----- accounts & roles
  ['GET', '/accounts/next-extension', () => {
    const used = list('accounts').map((a) => Number(a.agentExtension)).filter(Boolean);
    return { next: String(Math.max(1000, ...used) + 1) };
  }],
  ['GET', '/accounts', () => list('accounts')],
  ['POST', '/accounts', ({ body }) => {
    if (list('accounts').some((a) => a.email === body?.email)) throw new HttpError(409, 'That email already has an account');
    const role = byId('roles', body?.roleId);
    return create('accounts', 'acc', {
      firstName: body?.firstName, lastName: body?.lastName, email: body?.email,
      roleId: body?.roleId, roleName: role?.name ?? 'Agent',
      agentExtension: String(body?.extension ?? ''), active: true, superAdmin: false,
      managerId: body?.managerId || null,
      managerName: byId('accounts', body?.managerId ?? '')
        ? `${byId('accounts', body.managerId).firstName} ${byId('accounts', body.managerId).lastName}` : null,
      canManageTeam: !!role?.permissions?.team?.enabled,
      campaigns: [],
    });
  }],
  ['PATCH', '/accounts/*', ({ params, body }) => {
    const role = body?.roleId ? byId('roles', body.roleId) : null;
    const mgr = body?.managerId ? byId('accounts', body.managerId) : null;
    return patch('accounts', params[0], {
      ...body,
      ...(role ? { roleName: role.name, canManageTeam: !!role.permissions?.team?.enabled } : {}),
      managerName: mgr ? `${mgr.firstName} ${mgr.lastName}` : null,
    });
  }],

  ['GET', '/roles', () => list('roles')],
  ['POST', '/roles', ({ body }) => create('roles', 'rol', { isSystem: false, ...body })],
  ['POST', '/roles/*/clone', ({ params }) => {
    const r = byId('roles', params[0]);
    if (!r) throw new HttpError(404, 'Role not found');
    return create('roles', 'rol', { name: `${r.name} (copy)`, permissions: r.permissions, isSystem: false });
  }],
  ['PATCH', '/roles/*', ({ params, body }) => patch('roles', params[0], body)],
  ['DELETE', '/roles/*', ({ params }) => {
    if (byId('roles', params[0])?.isSystem) throw new HttpError(400, 'System roles cannot be deleted');
    remove('roles', params[0]);
    return null;
  }],

  // ----- billing
  ['GET', '/billing/me', () => {
    const plan = list('plans')[1];
    return {
      plan,
      limits: plan.limits,
      usage: {
        extensions: list('accounts').filter((a) => a.agentExtension).length,
        agents: list('accounts').filter((a) => a.active).length,
        campaigns: list('campaigns').length,
        callsThisPeriod: list('callLogs').length * 67,
      },
    };
  }],
  ['GET', '/billing/invoices', () => list('invoices')],
  ['POST', '/billing/invoices/*/pay', ({ params }) => {
    patch('invoices', params[0], { status: 'paid' });
    return { status: 'manual', detail: 'Demo mode — invoice marked as paid locally.' };
  }],

  /* =================================================================== *
   * Platform Console — the vendor's control plane, above every tenant.  *
   * =================================================================== */

  ['GET', '/platform/overview', () => platformOverview()],

  ['GET', '/platform/tenants', () => list('tenants').map(withTenantDerived)],
  ['POST', '/platform/tenants', ({ body }) => {
    const plan = byId('plans', body?.planId ?? '') ?? list('plans')[0];
    const name = String(body?.name ?? '').trim();
    if (!name) throw new HttpError(400, 'Company name is required');
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (list('tenants').some((t) => t.slug === slug)) throw new HttpError(409, 'A company with that name already exists');
    const t = create('tenants', 'ten', {
      name, slug,
      status: body?.startTrial === false ? 'active' : 'trial',
      planId: plan.id, plan: plan.name,
      region: body?.region ?? 'Lagos',
      trialEndsAt: body?.startTrial === false ? null : new Date(Date.now() + (plan.trialDays || 14) * DAY).toISOString(),
      primaryContact: { name: body?.adminName ?? '', email: body?.adminEmail ?? '', phone: body?.phone ?? '' },
      usage: { extensions: 0, agents: 0, callsThisPeriod: 0, minutesThisPeriod: 0, concurrentPeak: 0, storageGb: 0 },
      limits: plan.limits,
      mrr: body?.startTrial === false ? plan.priceMonthly : 0,
      churnRisk: 'low', healthScore: 100,
      lastActivityAt: new Date().toISOString(),
      notes: '',
    });
    audit('tenant.created', t.name, 'info');
    return t;
  }],
  ['GET', '/platform/tenants/*', ({ params }) => {
    const t = byId('tenants', params[0]);
    if (!t) throw new HttpError(404, 'Company not found');
    return {
      ...withTenantDerived(t),
      invoices: list('invoices').filter((i) => i.tenantId === t.id),
      activity: list('auditLog').filter((a) => a.target.includes(t.name)).slice(0, 8),
    };
  }],
  ['PATCH', '/platform/tenants/*', ({ params, body }) => {
    const t = patch('tenants', params[0], body);
    audit('tenant.updated', t.name, 'info');
    return t;
  }],
  ['DELETE', '/platform/tenants/*', ({ params }) => {
    const t = byId('tenants', params[0]);
    remove('tenants', params[0]);
    if (t) audit('tenant.deleted', t.name, 'critical');
    return null;
  }],
  ['POST', '/platform/tenants/*/suspend', ({ params }) => {
    const t = patch('tenants', params[0], { status: 'suspended', mrr: 0 });
    audit('tenant.suspended', t.name, 'critical');
    return t;
  }],
  ['POST', '/platform/tenants/*/activate', ({ params }) => {
    const t = byId('tenants', params[0]);
    const plan = byId('plans', t?.planId ?? '');
    const updated = patch('tenants', params[0], { status: 'active', mrr: plan?.priceMonthly ?? 0, trialEndsAt: null });
    audit('tenant.activated', updated.name, 'info');
    return updated;
  }],
  ['POST', '/platform/tenants/*/plan', ({ params, body }) => {
    const plan = byId('plans', body?.planId);
    if (!plan) throw new HttpError(400, 'Unknown plan');
    const t = byId('tenants', params[0]);
    const updated = patch('tenants', params[0], {
      planId: plan.id, plan: plan.name, limits: plan.limits,
      mrr: t?.status === 'suspended' || t?.status === 'trial' ? 0 : plan.priceMonthly,
    });
    audit('tenant.plan_changed', `${updated.name} → ${plan.name}`, 'warning');
    return updated;
  }],
  ['POST', '/platform/tenants/*/invoice', ({ params }) => {
    const t = byId('tenants', params[0]);
    if (!t) throw new HttpError(404, 'Company not found');
    const inv = create('invoices', 'inv', {
      tenantId: t.id, tenantName: t.name, amount: t.mrr || byId('plans', t.planId)?.priceMonthly || 0,
      currency: 'NGN', status: 'open', dueAt: new Date(Date.now() + 14 * DAY).toISOString(),
      period: `Manual · ${t.plan}`,
    });
    audit('invoice.issued', `${t.name} · ${fmtNaira(inv.amount)}`, 'info');
    return inv;
  }],
  ['POST', '/platform/tenants/*/impersonate', ({ params }) => {
    const t = byId('tenants', params[0]);
    if (!t) throw new HttpError(404, 'Company not found');
    if (t.status === 'suspended') throw new HttpError(409, 'Reactivate the company before opening its workspace');
    audit('tenant.impersonated', t.name, 'warning');
    return { tenantId: t.id, tenantName: t.name, startedAt: new Date().toISOString() };
  }],

  ['GET', '/platform/plans', () => list('plans').map((p) => ({
    ...p,
    tenantCount: list('tenants').filter((t) => t.planId === p.id).length,
    mrr: list('tenants').filter((t) => t.planId === p.id).reduce((s, t) => s + (t.mrr || 0), 0),
  }))],
  ['POST', '/platform/plans', ({ body }) => {
    const p = create('plans', 'pln', { active: true, currency: 'NGN', billingPeriod: 'month', features: [], trialDays: 14, ...body });
    audit('plan.created', p.name, 'warning');
    return p;
  }],
  ['PATCH', '/platform/plans/*', ({ params, body }) => {
    const p = patch('plans', params[0], body);
    // Keep every tenant on this plan in step with its new limits and price.
    for (const t of list('tenants').filter((x) => x.planId === p.id)) {
      t.plan = p.name;
      t.limits = p.limits;
      if (t.status === 'active' || t.status === 'past_due') t.mrr = p.priceMonthly;
    }
    save();
    audit('plan.updated', `${p.name} · ${fmtNaira(p.priceMonthly)}`, 'warning');
    return p;
  }],
  ['DELETE', '/platform/plans/*', ({ params }) => {
    if (list('tenants').some((t) => t.planId === params[0])) {
      throw new HttpError(409, 'Move the companies on this plan before deleting it');
    }
    const p = byId('plans', params[0]);
    remove('plans', params[0]);
    if (p) audit('plan.deleted', p.name, 'critical');
    return null;
  }],

  ['GET', '/platform/invoices', ({ query }) => {
    const status = query.get('status');
    const rows = list('invoices').slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    return status && status !== 'all' ? rows.filter((i) => i.status === status) : rows;
  }],
  ['GET', '/platform/revenue', () => ({
    series: db().revenueSeries,
    ...revenueTotals(),
    byPlan: list('plans').map((p) => ({
      name: p.name,
      tenants: list('tenants').filter((t) => t.planId === p.id).length,
      mrr: list('tenants').filter((t) => t.planId === p.id).reduce((s, t) => s + (t.mrr || 0), 0),
    })).filter((r) => r.tenants > 0),
  })],
  ['POST', '/platform/invoices/*/mark-paid', ({ params }) => {
    const i = patch('invoices', params[0], { status: 'paid' });
    if (i.tenantId) {
      const t = byId('tenants', i.tenantId);
      if (t?.status === 'past_due') patch('tenants', t.id, { status: 'active', notes: '' });
    }
    audit('invoice.marked_paid', `${i.tenantName} · ${fmtNaira(i.amount)}`, 'warning');
    return i;
  }],
  ['POST', '/platform/invoices/*/remind', ({ params }) => {
    const i = byId('invoices', params[0]);
    if (!i) throw new HttpError(404, 'Invoice not found');
    audit('invoice.reminded', `${i.tenantName} · ${fmtNaira(i.amount)}`, 'info');
    return { sent: true, to: byId('tenants', i.tenantId)?.primaryContact?.email ?? 'billing contact' };
  }],

  ['GET', '/platform/staff', () => list('platformStaff')],
  ['POST', '/platform/staff', ({ body }) => {
    const email = String(body?.email ?? '').trim().toLowerCase();
    if (!email) throw new HttpError(400, 'Email is required');
    if (list('platformStaff').some((s) => s.email.toLowerCase() === email)) throw new HttpError(409, 'That person already has access');
    const s = create('platformStaff', 'pst', {
      firstName: body?.firstName ?? '', lastName: body?.lastName ?? '', email,
      platformRole: body?.platformRole === 'super_admin' ? 'super_admin' : 'platform_admin',
      title: body?.title ?? '', mfaEnabled: false, active: true, lastSeenAt: null,
    });
    audit('staff.invited', `${email} as ${s.platformRole === 'super_admin' ? 'Super Admin' : 'Platform Admin'}`, 'critical');
    return s;
  }],
  ['PATCH', '/platform/staff/*', ({ params, body }) => {
    const before = byId('platformStaff', params[0]);
    // The platform must never be left without an owner.
    const supers = list('platformStaff').filter((s) => s.platformRole === 'super_admin' && s.active);
    const demoting = before?.platformRole === 'super_admin' && (body?.platformRole === 'platform_admin' || body?.active === false);
    if (demoting && supers.length <= 1) throw new HttpError(409, 'At least one active Super Admin must remain');
    const s = patch('platformStaff', params[0], body);
    audit('staff.updated', `${s.email}${body?.platformRole ? ` → ${body.platformRole}` : ''}`, 'critical');
    return s;
  }],
  ['DELETE', '/platform/staff/*', ({ params }) => {
    const s = byId('platformStaff', params[0]);
    const supers = list('platformStaff').filter((x) => x.platformRole === 'super_admin' && x.active);
    if (s?.platformRole === 'super_admin' && supers.length <= 1) throw new HttpError(409, 'At least one active Super Admin must remain');
    remove('platformStaff', params[0]);
    if (s) audit('staff.revoked', s.email, 'critical');
    return null;
  }],

  ['GET', '/platform/infrastructure', () => ({
    nodes: db().nodes,
    services: db().services,
    capacity: {
      channelsUsed: db().nodes.reduce((s: number, n: any) => s + n.channelsUsed, 0),
      channelCapacity: db().nodes.reduce((s: number, n: any) => s + n.channelCapacity, 0),
      nodesHealthy: db().nodes.filter((n: any) => n.status === 'healthy').length,
      nodesTotal: db().nodes.length,
    },
  })],
  ['POST', '/platform/nodes/*/drain', ({ params }) => {
    const n = patch('nodes', params[0], { status: 'draining' });
    audit('node.drained', n.name, 'warning');
    return n;
  }],
  ['POST', '/platform/nodes/*/enable', ({ params }) => {
    const n = patch('nodes', params[0], { status: 'healthy' });
    audit('node.enabled', n.name, 'warning');
    return n;
  }],

  ['GET', '/platform/audit', ({ query }) => {
    const sev = query.get('severity');
    const q = (query.get('q') ?? '').toLowerCase();
    return list('auditLog')
      .filter((a) => (!sev || sev === 'all' || a.severity === sev))
      .filter((a) => !q || `${a.actorName} ${a.action} ${a.target}`.toLowerCase().includes(q))
      .slice()
      .sort((a, b) => +new Date(b.at) - +new Date(a.at));
  }],

  ['GET', '/platform/announcements', () => list('announcements')],
  ['POST', '/platform/announcements', ({ body }) => {
    const a = create('announcements', 'ann', { status: 'draft', audience: 'all', createdBy: currentUser().firstName + ' ' + currentUser().lastName, ...body });
    audit('announcement.created', a.title, 'info');
    return a;
  }],
  ['PATCH', '/platform/announcements/*', ({ params, body }) => patch('announcements', params[0], body)],
  ['DELETE', '/platform/announcements/*', ({ params }) => { remove('announcements', params[0]); return null; }],

  ['GET', '/platform/settings', () => db().platformSettings],
  ['PATCH', '/platform/settings', ({ body }) => {
    Object.assign(db().platformSettings, body);
    save();
    audit('settings.updated', Object.keys(body ?? {}).join(', ') || 'platform settings', 'warning');
    return db().platformSettings;
  }],
];

function match(routePath: string, path: string): string[] | null {
  const r = routePath.split('/'), p = path.split('/');
  if (r.length !== p.length) return null;
  const params: string[] = [];
  for (let i = 0; i < r.length; i++) {
    if (r[i] === '*') { params.push(decodeURIComponent(p[i])); continue; }
    if (r[i] !== p[i]) return null;
  }
  return params;
}

/** Resolve a request against the demo data. Throws HttpError for 4xx paths. */
export function handleRequest(method: string, url: string, body: any): any {
  const [rawPath, rawQuery = ''] = url.split('?');
  const path = rawPath.replace(/\/$/, '') || '/';
  const query = new URLSearchParams(rawQuery);
  for (const [m, routePath, handler] of ROUTES) {
    if (m !== method) continue;
    const params = match(routePath, path);
    if (params) return handler({ method, path, query, body, params });
  }
  throw new HttpError(404, `No demo data for ${method} ${path}`);
}
