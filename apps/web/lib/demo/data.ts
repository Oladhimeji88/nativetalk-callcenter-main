// Seed dataset for UI-only (demo) mode.
//
// Everything the pages render comes from here instead of the NestJS API. The
// database lives in localStorage so edits made in the UI (new contact, renamed
// campaign, deleted queue…) survive a refresh. Clearing the key re-seeds.

const DB_KEY = 'nt_demo_db_v3';

// Deterministic PRNG — the seed data looks varied but is identical on every
// machine, so screenshots and bug reports line up.
let _seed = 20260729;
const rnd = () => { _seed = (_seed * 1664525 + 1013904223) % 4294967296; return _seed / 4294967296; };
const int = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));
const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];

const now = () => Date.now();
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

export type Db = Record<string, any[] | any>;

const PERMS_ALL = ['softphone', 'contacts', 'live', 'queues', 'campaigns', 'recordings', 'analytics', 'call_logs', 'pbx', 'users', 'billing', 'team'];
const permSet = (keys: string[]) => Object.fromEntries(PERMS_ALL.map((k) => [k, { enabled: keys.includes(k) }]));

// Fallback profile for an unrecognised sign-in: a full-access user inside the
// demo workspace, not platform staff.
export const DEMO_USER = {
  id: 'usr_admin',
  email: 'demo@nativetalk.io',
  firstName: 'Amara',
  lastName: 'Okonkwo',
  roleName: 'Administrator',
  agentExtension: '1001',
  superAdmin: false,
  platformRole: null as 'super_admin' | 'platform_admin' | null,
  tenant: 'NativeTalk Demo',
  permissions: permSet(PERMS_ALL),
};

const STAFF = [
  { first: 'Amara',    last: 'Okonkwo', ext: '1001', role: 'Administrator' },
  { first: 'Chinedu',  last: 'Eze',     ext: '1002', role: 'Agent' },
  { first: 'Fatima',   last: 'Bello',   ext: '1003', role: 'Agent' },
  { first: 'Tunde',    last: 'Adesina', ext: '1004', role: 'Supervisor' },
  { first: 'Ngozi',    last: 'Okafor',  ext: '1005', role: 'Agent' },
  { first: 'Samuel',   last: 'Idris',   ext: '1006', role: 'Agent', inactive: true },
  { first: 'Blessing', last: 'Uche',    ext: '1007', role: 'Agent' },
  { first: 'Kelechi',  last: 'Nnamdi',  ext: '1008', role: 'QA Lead' },
  { first: 'Ijeoma',   last: 'Balogun', ext: '1009', role: 'Administrator' },
];

export const staffEmail = (first: string, last: string) => `${first}.${last}`.toLowerCase() + '@nativetalk.io';

// Our own people, working above every customer company in the Platform Console.
// `platformRole` decides what they can reach there; they have no tenant workspace.
const PLATFORM_STAFF = [
  { first: 'Adaeze',  last: 'Nwankwo', role: 'super_admin',    title: 'Founder & CTO',            mfa: true },
  { first: 'Olumide', last: 'Faleye',  role: 'super_admin',    title: 'Head of Platform',         mfa: true },
  { first: 'Rita',    last: 'Okoye',   role: 'platform_admin', title: 'Customer Success Lead',    mfa: true },
  { first: 'Bashir',  last: 'Aliyu',   role: 'platform_admin', title: 'Onboarding Specialist',    mfa: false },
  { first: 'Chuka',   last: 'Obiora',  role: 'platform_admin', title: 'Technical Support',        mfa: true },
];

export const platformEmail = (first: string, last: string) => `${first}.${last}`.toLowerCase() + '@nativetalk.cloud';

// Sign-in shortcuts surfaced on the login screen in demo mode. Any password is
// accepted; these are listed so each role's view of the app can be compared.
export const DEMO_LOGINS = [
  { label: 'Super Admin',    email: platformEmail('Adaeze', 'Nwankwo'), password: 'demo1234', blurb: 'Platform Console — pricing, revenue, infra, staff' },
  { label: 'Platform Admin', email: platformEmail('Rita', 'Okoye'),     password: 'demo1234', blurb: 'Platform Console — customer operations only' },
  { label: 'Company Admin',  email: staffEmail('Ijeoma', 'Balogun'),    password: 'demo1234', blurb: 'One customer workspace, full access' },
  { label: 'Supervisor',     email: staffEmail('Tunde', 'Adesina'),     password: 'demo1234', blurb: 'Live ops, queues, campaigns, analytics' },
  { label: 'Agent',          email: staffEmail('Chinedu', 'Eze'),       password: 'demo1234', blurb: 'Console, contacts, own calls' },
];

const CONTACT_NAMES = [
  'Adaobi Nwosu', 'Emeka Obi', 'Zainab Yusuf', 'Ifeanyi Okoro', 'Halima Sani',
  'Chidi Anyanwu', 'Yetunde Bakare', 'Musa Danjuma', 'Nkechi Iheanacho', 'Segun Alabi',
  'Aisha Mohammed', 'Obinna Nwachukwu', 'Folake Ogunleye', 'Ibrahim Lawal', 'Chiamaka Eze',
  'Dele Fashola', 'Rukayat Adebayo', 'Uche Madu', 'Bola Ajayi', 'Grace Etim',
  'Peter Ochai', 'Hadiza Abubakar', 'Kunle Oyelaran', 'Amina Suleiman',
];
const COMPANIES = ['Zenith Retail', 'Kobo Logistics', 'Sahara Foods', 'Lekki Motors', 'Arewa Textiles', 'Delta Pharma', 'Palm Grove Ltd', ''];

const phone = (i: number) => `+234 80${(i % 9) + 1} ${String(200 + i * 7).padStart(3, '0')} ${String(1000 + i * 37).slice(-4)}`;

function seed(): Db {
  _seed = 20260729; // reset so a re-seed is reproducible

  const roles = [
    { id: 'rol_agent', name: 'Agent', isSystem: true, permissions: permSet(['softphone', 'contacts', 'campaigns', 'call_logs', 'recordings']) },
    { id: 'rol_super', name: 'Supervisor', isSystem: true, permissions: permSet(['softphone', 'contacts', 'live', 'queues', 'campaigns', 'recordings', 'analytics', 'call_logs', 'team']) },
    { id: 'rol_admin', name: 'Administrator', isSystem: true, permissions: permSet(PERMS_ALL) },
    { id: 'rol_qa', name: 'QA Lead', isSystem: false, permissions: permSet(['contacts', 'recordings', 'call_logs', 'analytics']) },
  ];
  const roleId = (name: string) => roles.find((r) => r.name === name)?.id ?? 'rol_agent';

  const accounts = STAFF.map((s: any, i) => {
    const leads = s.role === 'Supervisor' || s.role === 'Administrator';
    return {
      id: `acc_${s.ext}`,
      email: staffEmail(s.first, s.last),
      firstName: s.first,
      lastName: s.last,
      roleId: roleId(s.role),
      roleName: s.role,
      superAdmin: !!s.superAdmin,
      agentExtension: s.ext,
      active: !s.inactive,
      managerId: leads ? null : 'acc_1004',
      managerName: leads ? null : 'Tunde Adesina',
      canManageTeam: leads,
      campaigns: i % 3 === 1 ? ['Q4 Retention Drive'] : i % 3 === 2 ? ['New Product Launch'] : [],
    };
  });

  const groups = [
    { id: 'grp_lagos', name: 'Lagos Retail' },
    { id: 'grp_abuja', name: 'Abuja Enterprise' },
    { id: 'grp_renew', name: 'Renewals Due' },
    { id: 'grp_vip', name: 'VIP Accounts' },
  ];

  const customFields = [
    { id: 'cf_industry', key: 'industry', label: 'Industry', type: 'select', options: ['Retail', 'Tech', 'Health', 'Finance', 'Logistics'] },
    { id: 'cf_acct', key: 'account_no', label: 'Account no.', type: 'text', options: [] },
  ];

  const dispositions = [
    { id: 'dsp_1', name: 'Answered — Spoke', code: 'ANSWERED', category: 'Success', active: true, isSystem: true },
    { id: 'dsp_2', name: 'No Answer', code: 'NO_ANSWER', category: 'Retry', active: true, isSystem: true },
    { id: 'dsp_3', name: 'Busy', code: 'BUSY', category: 'Retry', active: true, isSystem: true },
    { id: 'dsp_4', name: 'Callback Requested', code: 'CALLBACK', category: 'Callback', active: true, isSystem: false },
    { id: 'dsp_5', name: 'Wrong Number', code: 'WRONG', category: 'Failure', active: true, isSystem: false },
    { id: 'dsp_6', name: 'Not Interested', code: 'NOT_INT', category: 'Failure', active: true, isSystem: false },
    { id: 'dsp_7', name: 'Sale Closed', code: 'SALE', category: 'Success', active: true, isSystem: false },
    { id: 'dsp_8', name: 'Do Not Call', code: 'DNC', category: 'DNC', active: true, isSystem: false },
  ];

  const contacts = CONTACT_NAMES.map((name, i) => {
    const contacted = i % 4 !== 3;
    return {
      id: `con_${i + 1}`,
      name,
      phone: phone(i + 1),
      email: `${name.split(' ')[0].toLowerCase()}@${(COMPANIES[i % COMPANIES.length] || 'mail').toLowerCase().replace(/\s+/g, '')}.com`,
      company: COMPANIES[i % COMPANIES.length],
      notes: i % 5 === 0 ? 'Prefers afternoon calls. Speaks Yoruba.' : '',
      groupIds: [groups[i % groups.length].id, ...(i % 6 === 0 ? ['grp_vip'] : [])].filter((v, k, a) => a.indexOf(v) === k),
      customFields: { industry: pick(['Retail', 'Tech', 'Health', 'Finance', 'Logistics']), account_no: `AC-${4200 + i}` },
      lastContactedAt: contacted ? iso(int(1, 200) * HOUR) : null,
      lastDisposition: contacted ? pick(dispositions).name : null,
    };
  });

  const campaigns = [
    {
      id: 'cmp_1', name: 'Q4 Retention Drive', directionType: 'Outbound', dialMethod: 'Preview', active: true,
      description: 'Win back customers who lapsed in Q3.', goal: '65% contact rate',
      contactGroupId: 'grp_renew', numbers: '', concurrency: 1, overdialRatio: 2, maxAttempts: 3,
      recording: true, amd: false, audioFile: '', assignedAgentIds: ['acc_1002', 'acc_1003'], queue: '',
      gateway: '', callerId: '+234 1 700 4000', scheduleStart: null, scheduleEnd: null,
      callWindowStart: '09:00', callWindowEnd: '17:00', timezone: 'Africa/Lagos',
      dispositionIds: [], excludeDispositionIds: [], createdAt: iso(30 * DAY),
    },
    {
      id: 'cmp_2', name: 'New Product Launch', directionType: 'Outbound', dialMethod: 'Progressive', active: true,
      description: 'Introduce the SME bundle to warm leads.', goal: '400 conversations/week',
      contactGroupId: 'grp_lagos', numbers: '', concurrency: 4, overdialRatio: 2, maxAttempts: 2,
      recording: true, amd: true, audioFile: '', assignedAgentIds: ['acc_1005', 'acc_1006', 'acc_1007'], queue: 'Sales',
      gateway: 'ng-carrier-1', callerId: '+234 1 700 4001', scheduleStart: null, scheduleEnd: null,
      callWindowStart: '08:30', callWindowEnd: '18:00', timezone: 'Africa/Lagos',
      dispositionIds: [], excludeDispositionIds: ['dsp_8'], createdAt: iso(18 * DAY),
    },
    {
      id: 'cmp_3', name: 'Renewal Outreach', directionType: 'Blended', dialMethod: 'Power', active: true,
      description: 'Contracts expiring within 30 days.', goal: '80% renewal rate',
      contactGroupId: 'grp_abuja', numbers: '', concurrency: 6, overdialRatio: 2.4, maxAttempts: 3,
      recording: true, amd: true, audioFile: '', assignedAgentIds: ['acc_1002', 'acc_1005'], queue: 'Billing',
      gateway: 'ng-carrier-1', callerId: '+234 1 700 4002', scheduleStart: null, scheduleEnd: null,
      callWindowStart: '09:00', callWindowEnd: '16:30', timezone: 'Africa/Lagos',
      dispositionIds: [], excludeDispositionIds: [], createdAt: iso(9 * DAY),
    },
    {
      id: 'cmp_4', name: 'Payment Reminder Broadcast', directionType: 'Outbound', dialMethod: 'VoiceBroadcast', active: false,
      description: 'Automated reminder for overdue invoices.', goal: '90% delivery',
      contactGroupId: 'grp_renew', numbers: '', concurrency: 10, overdialRatio: 1, maxAttempts: 1,
      recording: false, amd: true, audioFile: 'payment-reminder.wav', assignedAgentIds: [], queue: '',
      gateway: 'ng-carrier-2', callerId: '+234 1 700 4003', scheduleStart: null, scheduleEnd: null,
      callWindowStart: '10:00', callWindowEnd: '19:00', timezone: 'Africa/Lagos',
      dispositionIds: [], excludeDispositionIds: [], createdAt: iso(4 * DAY),
    },
  ];

  // Preview leads — one per contact in the campaign's group, plus a few worked
  // already so the progress counters aren't all zero.
  const leads: any[] = [];
  for (const c of campaigns) {
    const members = contacts.filter((x) => x.groupIds.includes(c.contactGroupId));
    members.forEach((m, i) => {
      leads.push({
        id: `led_${c.id}_${i}`, campaignId: c.id, contactId: m.id, phone: m.phone, name: m.name,
        status: i < 2 ? 'done' : 'open', disposition: i < 2 ? dispositions[i % 3].name : null, attempts: i < 2 ? 1 : 0,
      });
    });
  }

  const runs = [
    { id: 'run_1', campaignId: 'cmp_2', dialMethod: 'Progressive', status: 'done', startedAt: iso(2 * DAY), endedAt: iso(2 * DAY - 42 * MIN), dialed: 180, connected: 121, bridged: 114, abandoned: 7, failed: 59, ratio: 1 },
    { id: 'run_2', campaignId: 'cmp_2', dialMethod: 'Progressive', status: 'done', startedAt: iso(DAY), endedAt: iso(DAY - 55 * MIN), dialed: 210, connected: 148, bridged: 141, abandoned: 7, failed: 62, ratio: 1 },
    { id: 'run_3', campaignId: 'cmp_3', dialMethod: 'Power', status: 'done', startedAt: iso(6 * HOUR), endedAt: iso(5 * HOUR), dialed: 320, connected: 205, bridged: 186, abandoned: 19, failed: 115, ratio: 2.4 },
    { id: 'run_4', campaignId: 'cmp_3', dialMethod: 'Power', status: 'stopped', startedAt: iso(2 * HOUR), endedAt: iso(90 * MIN), dialed: 74, connected: 48, bridged: 45, abandoned: 3, failed: 26, ratio: 2.1 },
  ];

  const CAUSES = ['NORMAL_CLEARING', 'USER_BUSY', 'NO_ANSWER', 'ORIGINATOR_CANCEL', 'CALL_REJECTED'];
  const runCalls: any[] = [];
  for (const r of runs) {
    const n = Math.min(24, Math.round(r.dialed / 8));
    for (let i = 0; i < n; i++) {
      const answered = rnd() > 0.38;
      runCalls.push({
        runId: r.id, number: phone(int(1, 24)),
        status: answered ? (rnd() > 0.9 ? 'abandoned' : 'answered') : 'failed',
        attempts: int(1, 2),
        disposition: answered ? pick(dispositions).name : null,
        cause: answered ? 'NORMAL_CLEARING' : pick(CAUSES),
      });
    }
  }

  const queues = [
    { id: 'que_1', name: 'Support', number: '8001', strategy: 'longest-idle-agent', members: ['1002', '1003', '1005'], membersCount: 3, maxWaitSec: 300, slaTargetPct: 80, active: true, waiting: 2, avgWaitSec: 34, health: 'Healthy' },
    { id: 'que_2', name: 'Sales', number: '8002', strategy: 'round-robin', members: ['1005', '1006', '1007'], membersCount: 3, maxWaitSec: 240, slaTargetPct: 85, active: true, waiting: 5, avgWaitSec: 78, health: 'Busy' },
    { id: 'que_3', name: 'Billing', number: '8003', strategy: 'ring-all', members: ['1004', '1008'], membersCount: 2, maxWaitSec: 420, slaTargetPct: 75, active: true, waiting: 0, avgWaitSec: 12, health: 'Idle' },
    { id: 'que_4', name: 'VIP Desk', number: '8004', strategy: 'top-down', members: ['1001', '1004'], membersCount: 2, maxWaitSec: 120, slaTargetPct: 95, active: true, waiting: 9, avgWaitSec: 143, health: 'Overloaded' },
  ];

  const trunks = [
    { id: 'trk_1', name: 'ng-carrier-1', username: 'nt_demo_01', password: 's3cret-demo', proxy: 'sip.carrier-ng.com', realm: 'sip.carrier-ng.com', fromDomain: '', register: true, callerId: '+234 1 700 4000', active: true, provider: null },
    { id: 'trk_2', name: 'ng-carrier-2', username: 'nt_demo_02', password: 's3cret-demo', proxy: '41.203.18.22', realm: '', fromDomain: '', register: false, callerId: '+234 1 700 4003', active: true, provider: 'voipswitch' },
  ];

  // CDRs across the last week — the source for Call Logs, Recordings and the
  // dashboard's windowed KPIs.
  const callLogs: any[] = [];
  for (let i = 0; i < 72; i++) {
    const c = contacts[int(0, contacts.length - 1)];
    const staff = STAFF[int(1, STAFF.length - 1)];
    const answered = rnd() > 0.3;
    const direction = rnd() > 0.65 ? 'inbound' : 'outbound';
    const camp = rnd() > 0.45 ? campaigns[int(0, 2)] : null;
    const dur = answered ? int(25, 640) : 0;
    callLogs.push({
      id: `log_${i + 1}`,
      direction,
      agentExt: staff.ext,
      agentName: `${staff.first} ${staff.last}`,
      peerNumber: c.phone,
      contactId: c.id,
      contactName: c.name,
      campaignId: camp?.id ?? null,
      campaignName: camp?.name ?? null,
      disposition: answered ? pick(dispositions).name : (direction === 'inbound' ? 'No Answer' : 'Busy'),
      notes: rnd() > 0.7 ? 'Asked for a callback next week.' : '',
      status: answered ? 'completed' : direction === 'inbound' ? 'missed' : 'no-answer',
      durationSec: dur,
      recordingSec: dur ? Math.max(0, dur - int(0, 4)) : 0,
      startedAt: iso(int(1, 7 * 24) * HOUR + int(0, 59) * MIN),
      recording: answered && rnd() > 0.35 ? `rec_${i + 1}.wav` : null,
      disconnectedBy: answered ? pick(['agent', 'customer']) : null,
      fields: camp ? [{ label: 'Industry', value: c.customFields.industry }] : [],
    });
  }
  callLogs.sort((a, b) => +new Date(b.startedAt) - +new Date(a.startedAt));

  /* ===================================================================== *
   * Control plane — everything below belongs to the vendor, not a tenant. *
   * ===================================================================== */

  const plans = [
    {
      id: 'pln_start', name: 'Starter', priceMonthly: 4500000, currency: 'NGN', billingPeriod: 'month',
      tagline: 'Small teams taking their first calls online.',
      features: ['10 extensions', '2 campaigns', 'Call recording', 'Email support'],
      limits: { maxExtensions: 10, maxConcurrentCalls: 5, maxCampaigns: 2, maxMinutesPerMonth: 20000, storageGb: 10 },
      active: true, trialDays: 14,
    },
    {
      id: 'pln_growth', name: 'Growth', priceMonthly: 12000000, currency: 'NGN', billingPeriod: 'month',
      tagline: 'Growing contact centres running outbound campaigns.',
      features: ['50 extensions', 'Unlimited campaigns', 'Progressive + power dialer', 'Analytics', 'Priority support'],
      limits: { maxExtensions: 50, maxConcurrentCalls: 25, maxCampaigns: 20, maxMinutesPerMonth: 150000, storageGb: 100 },
      active: true, trialDays: 14,
    },
    {
      id: 'pln_ent', name: 'Enterprise', priceMonthly: 38000000, currency: 'NGN', billingPeriod: 'month',
      tagline: 'High-volume operations needing dedicated capacity.',
      features: ['Unlimited extensions', 'Predictive dialer', 'Dedicated media node', 'SSO', '24/7 support', 'SLA 99.95%'],
      limits: { maxExtensions: 500, maxConcurrentCalls: 200, maxCampaigns: 200, maxMinutesPerMonth: 1000000, storageGb: 1000 },
      active: true, trialDays: 30,
    },
    {
      id: 'pln_legacy', name: 'Pilot (legacy)', priceMonthly: 2000000, currency: 'NGN', billingPeriod: 'month',
      tagline: 'Closed to new signups — retained for two early customers.',
      features: ['5 extensions', '1 campaign'],
      limits: { maxExtensions: 5, maxConcurrentCalls: 3, maxCampaigns: 1, maxMinutesPerMonth: 5000, storageGb: 5 },
      active: false, trialDays: 0,
    },
  ];
  const planById = (id: string) => plans.find((p) => p.id === id)!;

  const TENANT_SEED = [
    { name: 'NativeTalk Demo',   plan: 'pln_growth', status: 'active',    region: 'Lagos',   ext: 9,  agents: 8,  calls: 4820,  age: 240, contact: 'Amara Okonkwo',  risk: 'low' },
    { name: 'Zenith Retail',     plan: 'pln_start',  status: 'active',    region: 'Lagos',   ext: 8,  agents: 6,  calls: 1160,  age: 180, contact: 'Bimpe Adeyemi',  risk: 'low' },
    { name: 'Kobo Logistics',    plan: 'pln_ent',    status: 'suspended', region: 'Abuja',   ext: 42, agents: 38, calls: 0,     age: 420, contact: 'Ifeanyi Nwosu',  risk: 'high' },
    { name: 'Sahara Foods',      plan: 'pln_growth', status: 'active',    region: 'Kano',    ext: 24, agents: 21, calls: 9640,  age: 150, contact: 'Hauwa Sanusi',   risk: 'low' },
    { name: 'Lekki Motors',      plan: 'pln_start',  status: 'past_due',  region: 'Lagos',   ext: 6,  agents: 5,  calls: 740,   age: 95,  contact: 'Segun Oyelaran', risk: 'high' },
    { name: 'Arewa Microfinance',plan: 'pln_ent',    status: 'active',    region: 'Kaduna',  ext: 96, agents: 88, calls: 31200, age: 300, contact: 'Musa Danjuma',   risk: 'low' },
    { name: 'Delta Pharma',      plan: 'pln_growth', status: 'trial',     region: 'Port Harcourt', ext: 12, agents: 9, calls: 410, age: 9, contact: 'Grace Etim',  risk: 'medium' },
    { name: 'Palm Grove Ltd',    plan: 'pln_legacy', status: 'active',    region: 'Ibadan',  ext: 5,  agents: 4,  calls: 620,   age: 610, contact: 'Dele Fashola',   risk: 'medium' },
    { name: 'Coastline Insurance', plan: 'pln_growth', status: 'trial',   region: 'Lagos',   ext: 7,  agents: 6,  calls: 180,   age: 3,   contact: 'Rukayat Bello',  risk: 'low' },
  ];

  const tenants = TENANT_SEED.map((t, i) => {
    const plan = planById(t.plan);
    const slug = t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const billable = t.status === 'active' || t.status === 'past_due';
    return {
      id: `ten_${i + 1}`,
      name: t.name,
      slug,
      status: t.status, // active | trial | past_due | suspended
      planId: plan.id,
      plan: plan.name,
      region: t.region,
      createdAt: iso(t.age * DAY),
      trialEndsAt: t.status === 'trial' ? new Date(Date.now() + (14 - t.age) * DAY).toISOString() : null,
      primaryContact: {
        name: t.contact,
        email: `${t.contact.split(' ')[0].toLowerCase()}@${slug}.com`,
        phone: phone(i + 3),
      },
      usage: {
        extensions: t.ext,
        agents: t.agents,
        callsThisPeriod: t.calls,
        minutesThisPeriod: Math.round(t.calls * 3.4),
        concurrentPeak: Math.max(1, Math.round(t.agents * 0.7)),
        storageGb: Math.round(t.calls / 120),
      },
      limits: plan.limits,
      mrr: billable ? plan.priceMonthly : 0,
      churnRisk: t.risk,
      healthScore: t.status === 'suspended' ? 12 : t.risk === 'high' ? 44 : t.risk === 'medium' ? 71 : 88,
      lastActivityAt: t.status === 'suspended' ? iso(21 * DAY) : iso(int(1, 40) * HOUR),
      notes: t.status === 'past_due' ? 'Card declined twice. Finance chasing.' : '',
    };
  });

  const platformStaff = PLATFORM_STAFF.map((s, i) => ({
    id: `pst_${i + 1}`,
    firstName: s.first,
    lastName: s.last,
    email: platformEmail(s.first, s.last),
    platformRole: s.role,
    title: s.title,
    mfaEnabled: s.mfa,
    active: true,
    createdAt: iso((400 - i * 60) * DAY),
    lastSeenAt: iso(int(1, 50) * HOUR),
  }));

  // Invoices are per-tenant so revenue can be attributed in the console.
  const invoices: any[] = [];
  for (const t of tenants) {
    if (!t.mrr) continue;
    for (let m = 0; m < 3; m++) {
      const overdue = t.status === 'past_due' && m === 0;
      invoices.push({
        id: `inv_${t.id}_${m}`,
        tenantId: t.id,
        tenantName: t.name,
        createdAt: iso((m * 30 + 2) * DAY),
        dueAt: iso((m * 30 - 12) * DAY),
        amount: t.mrr,
        currency: 'NGN',
        status: m === 0 ? (overdue ? 'overdue' : 'open') : 'paid',
        period: `${m === 0 ? 'Current' : m === 1 ? 'Last' : '2 months ago'} · ${t.plan}`,
      });
    }
  }

  // 12 months of movement, so the revenue chart has a real shape.
  const revenueSeries = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.now() - (11 - i) * 30 * DAY);
    const base = 42_000_000 + i * 6_200_000;
    return {
      label: d.toLocaleString('en', { month: 'short' }),
      mrr: base,
      newMrr: 3_000_000 + int(0, 4) * 900_000,
      churnedMrr: i === 7 ? 4_500_000 : int(0, 2) * 700_000,
    };
  });

  const nodes = [
    { id: 'nod_1', name: 'fs-lagos-01',  role: 'media',      region: 'Lagos',  status: 'healthy',  channelsUsed: 184, channelCapacity: 500, cpuPct: 41, memPct: 58, uptimeHours: 2184, version: '1.10.11', tenantsServed: 5 },
    { id: 'nod_2', name: 'fs-lagos-02',  role: 'media',      region: 'Lagos',  status: 'healthy',  channelsUsed: 142, channelCapacity: 500, cpuPct: 33, memPct: 51, uptimeHours: 2184, version: '1.10.11', tenantsServed: 4 },
    { id: 'nod_3', name: 'fs-abuja-01',  role: 'media',      region: 'Abuja',  status: 'degraded', channelsUsed: 421, channelCapacity: 500, cpuPct: 87, memPct: 79, uptimeHours: 640,  version: '1.10.9',  tenantsServed: 3 },
    { id: 'nod_4', name: 'sbc-edge-01',  role: 'signalling', region: 'Lagos',  status: 'healthy',  channelsUsed: 96,  channelCapacity: 800, cpuPct: 22, memPct: 37, uptimeHours: 4320, version: '1.10.11', tenantsServed: 9 },
    { id: 'nod_5', name: 'fs-kano-01',   role: 'media',      region: 'Kano',   status: 'draining', channelsUsed: 12,  channelCapacity: 300, cpuPct: 9,  memPct: 24, uptimeHours: 96,   version: '1.10.11', tenantsServed: 1 },
  ];

  const services = [
    { id: 'svc_api',   name: 'REST API',           status: 'operational', latencyMs: 82,  uptimePct: 99.98, detail: 'p95 response over the last hour' },
    { id: 'svc_ws',    name: 'Realtime gateway',   status: 'operational', latencyMs: 31,  uptimePct: 99.99, detail: '1,204 sockets connected' },
    { id: 'svc_db',    name: 'PostgreSQL primary', status: 'operational', latencyMs: 6,   uptimePct: 99.99, detail: 'replication lag 240ms' },
    { id: 'svc_redis', name: 'Redis',              status: 'operational', latencyMs: 2,   uptimePct: 100,   detail: 'memory 38% of 4GB' },
    { id: 'svc_esl',   name: 'FreeSWITCH ESL',     status: 'degraded',    latencyMs: 410, uptimePct: 99.21, detail: 'fs-abuja-01 responding slowly' },
    { id: 'svc_rec',   name: 'Recording storage',  status: 'operational', latencyMs: 120, uptimePct: 99.95, detail: '1.8 TB of 4 TB used' },
  ];

  const AUDIT = [
    ['Adaeze Nwankwo', 'super_admin',    'plan.updated',        'Growth plan price → NGN 120,000', 'warning',  3],
    ['Rita Okoye',     'platform_admin', 'tenant.suspended',    'Kobo Logistics',                  'critical', 8],
    ['Rita Okoye',     'platform_admin', 'tenant.impersonated', 'Sahara Foods',                    'warning',  11],
    ['Bashir Aliyu',   'platform_admin', 'tenant.created',      'Coastline Insurance',             'info',     26],
    ['Olumide Faleye', 'super_admin',    'node.drained',        'fs-kano-01',                      'warning',  30],
    ['Chuka Obiora',   'platform_admin', 'tenant.plan_changed', 'Delta Pharma → Growth',           'info',     36],
    ['Adaeze Nwankwo', 'super_admin',    'staff.invited',       'chuka.obiora@nativetalk.cloud',   'warning',  52],
    ['Rita Okoye',     'platform_admin', 'invoice.reminded',    'Lekki Motors · NGN 45,000',       'info',     60],
    ['Adaeze Nwankwo', 'super_admin',    'security.mfa_enforced', 'All platform staff',            'critical', 74],
    ['Olumide Faleye', 'super_admin',    'settings.updated',    'Signups closed on Pilot plan',    'warning',  96],
    ['Bashir Aliyu',   'platform_admin', 'tenant.activated',    'Palm Grove Ltd',                  'info',     120],
    ['Chuka Obiora',   'platform_admin', 'tenant.impersonated', 'Lekki Motors',                    'warning',  144],
  ];
  const auditLog = AUDIT.map(([actor, role, action, target, severity, hoursAgo], i) => ({
    id: `aud_${i + 1}`,
    at: iso(Number(hoursAgo) * HOUR),
    actorName: actor as string,
    actorEmail: platformEmail(String(actor).split(' ')[0], String(actor).split(' ')[1]),
    actorRole: role as string,
    action: action as string,
    target: target as string,
    severity: severity as string,
    ip: `102.89.${int(1, 250)}.${int(1, 250)}`,
  }));

  const announcements = [
    { id: 'ann_1', title: 'Scheduled maintenance — Sunday 02:00 WAT', body: 'Media nodes in Lagos will fail over one at a time. Calls in progress are preserved; no action needed.', audience: 'all', status: 'scheduled', publishAt: iso(-2 * DAY), createdBy: 'Olumide Faleye' },
    { id: 'ann_2', title: 'Predictive dialer now on Growth', body: 'Predictive pacing has been released to all Growth-plan workspaces at no extra cost.', audience: 'plan:pln_growth', status: 'published', publishAt: iso(6 * DAY), createdBy: 'Adaeze Nwankwo' },
    { id: 'ann_3', title: 'Pilot plan retirement', body: 'The legacy Pilot plan closes on 31 December. Affected customers will be migrated to Starter.', audience: 'plan:pln_legacy', status: 'draft', publishAt: null, createdBy: 'Adaeze Nwankwo' },
  ];

  const platformSettings = {
    signupsOpen: true,
    defaultPlanId: 'pln_start',
    trialDays: 14,
    enforceStaffMfa: true,
    staffSessionTimeoutMins: 60,
    ipAllowlist: ['102.89.0.0/16', '41.203.18.22'],
    maintenanceMode: false,
    supportEmail: 'support@nativetalk.cloud',
    dataRetentionDays: 365,
    recordingRetentionDays: 90,
  };

  return {
    roles, accounts, groups, customFields, dispositions, contacts, campaigns, leads,
    runs, runCalls, queues, trunks, callLogs,
    plans, invoices, tenants, platformStaff, revenueSeries, nodes, services,
    auditLog, announcements, platformSettings,
    joined: { campaignId: null as string | null },
    session: null as any, // the signed-in demo account (set by POST /auth/login)
    seededAt: now(),
  };
}

let cache: Db | null = null;

export function db(): Db {
  if (cache) return cache;

  const fresh = seed();

  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(DB_KEY);
      if (raw) {
        const saved = JSON.parse(raw) ?? {};
        // Layer what this browser has saved over a fresh seed. Anything added to
        // the schema since it last seeded (a new table, a new settings object)
        // is filled in from `fresh`, so an older stored copy can never leave the
        // app reading an undefined collection.
        cache = { ...fresh, ...saved };
        for (const key of Object.keys(fresh)) {
          const mine = (cache as any)[key];
          const seeded = (fresh as any)[key];
          const missing = mine == null || (Array.isArray(seeded) && !Array.isArray(mine));
          if (missing) (cache as any)[key] = seeded;
        }
        save();
        return cache!;
      }
    } catch { /* corrupt or unavailable — fall through to the fresh seed */ }
  }

  cache = fresh;
  save();
  return cache!;
}

export function save() {
  if (typeof window === 'undefined' || !cache) return;
  try { localStorage.setItem(DB_KEY, JSON.stringify(cache)); } catch { /* quota — keep in memory */ }
}

export function resetDb() {
  cache = null;
  if (typeof window !== 'undefined') { try { localStorage.removeItem(DB_KEY); } catch { /* ignore */ } }
  return db();
}

export const uid = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
export { rnd, int, pick };
