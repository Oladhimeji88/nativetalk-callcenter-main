import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { FreeswitchService } from '../freeswitch/freeswitch.service';
import { computeOverdialSlots, computePredictiveRatio } from './pacing';

type ItemStatus = 'queued' | 'dialing' | 'answered' | 'failed' | 'skipped' | 'stopped';
interface RunItem {
  number: string;
  status: ItemStatus;
  attempts: number;
  cause: string | null;
  disposition: string | null;
  agent: string | null;
  recording: string | null;
  leadId: string | null; // materialised lead this item works, so outcomes update its status/lastDisposition
}
interface Run {
  runId: string; // becomes the persisted CampaignRun.id; stamped on every CallAttempt
  campaignId: string;
  tenantId: string;
  name: string;
  mode: 'agent' | 'broadcast';
  status: 'running' | 'stopping' | 'stopped' | 'done' | 'error';
  startedAt: string;
  finishedAt: string | null;
  note: string | null; // why the run stopped early (e.g. outside the call window)
  queue: string | null; // resolved ACD queue answered calls bridge into (agent mode)
  queueLoaded: boolean; // whether we loaded this run's queue into mod_callcenter
  tiers: { queue: string; agent: string; ext: string }[]; // tiers we added (per joined agent), to remove on leave/stop
  joinedAgents: string[]; // extensions of agents currently played-in to this campaign
  items: RunItem[];
  // Outcome of answered calls once they reach the ACD queue (from mod_callcenter
  // events): bridged = reached an agent; abandoned = left the queue without one.
  bridged: number;
  abandoned: number;
  bridgedMembers: Set<string>; // member UUIDs that bridged, so member-queue-end knows a call wasn't abandoned
  ratio: number; // current over-dial ratio in effect (Power: fixed; Predictive: live)
}

const ORIGINATE_TIMEOUT = 30;
const MAX_CONCURRENCY = 10;
const MAX_OVERDIAL_RATIO = 3;       // safety ceiling on Power/Predictive over-dial
const AGENT_POLL_MS = 1500;         // how often progressive re-checks for a free agent
const QUEUE_DRAIN_MAX_MS = 30 * 60_000; // safety cap: how long to hold the tier up waiting for the last answered call to finish bridging
const DONE_STATES = new Set(['done', 'stopped', 'error']);
const DEFAULT_AUDIO = 'ivr/ivr-welcome_to_freeswitch.wav';
// Concrete recordings folder (forward slashes work on Windows FreeSWITCH).
export const REC_DIR = (process.env.FS_RECORDINGS_DIR ?? 'C:/Program Files/FreeSWITCH/recordings').replace(/\\/g, '/');

/**
 * Outbound dialer engine (Phase 3) on the new stack.
 *
 * The headline upgrade over the legacy voice-broadcast dialer: when a call is
 * answered it can be **bridged into an ACD queue** so a live, available agent is
 * connected (progressive/power dialing) — instead of only playing a recording.
 * Honours DNC, retries unanswered numbers, records, assigns a disposition to
 * every attempt, and persists each attempt to Postgres for reporting.
 */
@Injectable()
export class DialerService {
  private readonly logger = new Logger(DialerService.name);
  private runs = new Map<string, Run>();
  private traceBuf: string[] = []; // ring buffer of dialer lifecycle events (GET /campaigns/_trace)
  private slugByTenant = new Map<string, string>(); // tenantId → slug (dialplan context), cached
  private lastReadiness = ''; // per-agent status/state from the most recent availableAgents() call (for tracing)

  constructor(private prisma: PrismaService, private fs: FreeswitchService) {
    // Track bridged vs abandoned answered calls from mod_callcenter events.
    this.fs.onCallcenterEvent((ev) => this.handleCallcenterEvent(ev));
  }

  /** mod_callcenter event → update the matching run's bridged/abandoned counters.
   *  A member that reaches an agent fires bridge-agent-start; one that leaves the
   *  queue without ever bridging (member-queue-end, unseen member) is abandoned. */
  private handleCallcenterEvent(ev: Record<string, string>) {
    const action = ev['CC-Action'] || '';
    if (action !== 'bridge-agent-start' && action !== 'member-queue-end') return;
    const queue = ev['CC-Queue'] || '';
    if (!queue) return;
    const norm = (q: string) => q.split('@')[0];
    const run = [...this.runs.values()].find((r) => r.queue && norm(r.queue) === norm(queue));
    if (!run) return;
    const member = ev['CC-Member-UUID'] || ev['CC-Member-Session-UUID'] || '';
    if (!member) return;
    if (action === 'bridge-agent-start') {
      if (!run.bridgedMembers.has(member)) {
        run.bridgedMembers.add(member);
        run.bridged++;
        this.tr(run.campaignId, `CC bridged member=${member.slice(0, 8)} agent=${ev['CC-Agent'] || ''} bridged=${run.bridged}`);
      }
    } else { // member-queue-end
      if (run.bridgedMembers.has(member)) {
        run.bridgedMembers.delete(member); // ended a bridged call — not abandoned
      } else {
        run.abandoned++;
        this.tr(run.campaignId, `CC abandoned member=${member.slice(0, 8)} reason=${ev['CC-Cancel-Reason'] || ''} abandoned=${run.abandoned}`);
      }
    }
  }

  /** Append a dialer lifecycle event to the in-memory trace (and the app log), for
   *  diagnosing progressive join/tier/dial timing. Read via getTrace(). */
  private tr(campaignId: string | null, msg: string) {
    const t = new Date().toISOString().slice(11, 23);
    const line = `${t} ${campaignId ? `[${campaignId.slice(-6)}] ` : ''}${msg}`;
    this.traceBuf.push(line);
    if (this.traceBuf.length > 800) this.traceBuf.shift();
    this.logger.log(`[trace] ${line}`);
  }
  getTrace(limit = 400): string[] { return this.traceBuf.slice(-limit); }
  clearTrace() { this.traceBuf = []; }

  getRun(campaignId: string): Run | null {
    return this.runs.get(campaignId) ?? null;
  }

  /** The campaign this agent is currently played into (their ext is in a live run's
   *  roster), or null. Lets the Console restore the "on campaign" state after a
   *  page refresh instead of showing the agent as idle while still tiered. */
  activeCampaignForAgent(tenantId: string, agentExt: string | null): string | null {
    if (!agentExt) return null;
    for (const r of this.runs.values()) {
      if (r.tenantId !== tenantId || DONE_STATES.has(r.status)) continue;
      if (r.joinedAgents.includes(agentExt)) return r.campaignId;
    }
    return null;
  }

  /** Whether an agent is still playing in, plus the run status + leads left — for
   *  the Console to detect when a campaign has finished and take them off. */
  agentParticipation(campaignId: string, ext: string | null) {
    const run = this.runs.get(campaignId);
    if (!run) return { joined: false, status: null, pending: 0, pulse: null };
    const joined = !!ext && run.joinedAgents.includes(ext);
    const c = (s: ItemStatus) => run.items.filter((i) => i.status === s).length;
    const pending = c('queued') + c('dialing');
    // A scoped live pulse for the agent Console strip: what this campaign is doing
    // right now, so the agent isn't staring at a black box between calls.
    const resolved = run.bridged + run.abandoned;                // answered calls whose queue outcome is known
    const pulse = {
      status: run.status,
      total: run.items.length,
      remaining: pending,
      dialing: c('dialing'),                                   // calls ringing out to customers now
      done: c('answered') + c('failed') + c('skipped') + c('stopped'),
      connected: c('answered'),                                // calls that reached a customer (picked up)
      bridged: run.bridged,                                    // ...of those, reached an agent
      abandoned: run.abandoned,                                // ...answered but left the queue with no agent
      abandonRate: resolved ? Math.round((run.abandoned / resolved) * 1000) / 10 : 0, // %
      agentsOn: run.joinedAgents.length,
      ratio: Math.round(run.ratio * 100) / 100,               // live over-dial ratio (Power fixed / Predictive dynamic)
    };
    return { joined, status: run.status, pending, pulse };
  }

  private parseNumbers(raw?: string | null): string[] {
    return Array.from(new Set(
      (raw || '').split(/[\s,;\n]+/).map((s) => s.trim()).filter((s) => /\d{3,}/.test(s)),
    ));
  }

  // Campaigns list enriched with the stats the UI shows: contacts count, contact
  // rate (% of contacts reached), and the resolved assigned agents.
  async campaignsOverview(tenantId: string) {
    const campaigns = await this.prisma.outboundCampaign.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
    const accounts = await this.prisma.account.findMany({
      where: { tenantId },
      select: { id: true, firstName: true, lastName: true, agentExtension: true },
    });
    const acctById = new Map(accounts.map((a) => [a.id, a]));
    // Lifetime run stats per campaign (summed across all finished runs).
    const runAgg = await this.prisma.campaignRun.groupBy({
      by: ['campaignId'],
      where: { tenantId },
      _sum: { bridged: true, abandoned: true, dialed: true, connected: true },
      _count: { _all: true },
    });
    const runByCampaign = new Map(runAgg.map((r) => [r.campaignId, r]));
    const out: any[] = [];
    for (const c of campaigns) {
      // Prefer the live source count so edits (e.g. deleting contacts from the
      // targeted group) reflect immediately; fall back to materialised leads only
      // when the campaign has no source configured any more.
      const sourceCount = await this.sourceContactsCount(tenantId, c);
      const contactsCount = sourceCount || (await this.prisma.lead.count({ where: { tenantId, campaignId: c.id } }));
      const logs = await this.prisma.callLog.findMany({ where: { tenantId, campaignId: c.id }, select: { peerNumber: true, status: true } });
      const contacted = new Set(logs.filter((l) => l.status === 'completed').map((l) => l.peerNumber));
      const contactRate = contactsCount ? Math.round((contacted.size / contactsCount) * 1000) / 10 : 0;
      const agents = (c.assignedAgentIds || [])
        .map((id) => acctById.get(id))
        .filter(Boolean)
        .map((a) => ({ id: a!.id, name: [a!.firstName, a!.lastName].filter(Boolean).join(' ') || a!.agentExtension || 'Agent', ext: a!.agentExtension }));
      const ra = runByCampaign.get(c.id);
      const lifeBridged = ra?._sum.bridged ?? 0;
      const lifeAbandoned = ra?._sum.abandoned ?? 0;
      const resolved = lifeBridged + lifeAbandoned;
      out.push({
        ...c, contactsCount, contactRate, agents, agentCount: agents.length,
        runCount: ra?._count._all ?? 0,
        lifetimeDialed: ra?._sum.dialed ?? 0,
        lifetimeConnected: ra?._sum.connected ?? 0,
        lifetimeBridged: lifeBridged,
        lifetimeAbandoned: lifeAbandoned,
        abandonRate: resolved ? Math.round((lifeAbandoned / resolved) * 1000) / 10 : 0,
      });
    }
    return out;
  }

  /** A campaign's finished-run history (most recent first) for the reports view. */
  async campaignRuns(tenantId: string, campaignId: string) {
    return this.prisma.campaignRun.findMany({
      where: { tenantId, campaignId },
      orderBy: { endedAt: 'desc' },
      take: 100,
    });
  }

  /** The per-call detail of one finished run (what the live Monitor showed while
   *  it ran). New attempts carry the run's id; attempts persisted before runId
   *  existed are matched by the run's time window instead, so old history still
   *  opens. */
  async campaignRunCalls(tenantId: string, campaignId: string, runId: string) {
    const run = await this.prisma.campaignRun.findFirst({ where: { id: runId, tenantId, campaignId } });
    if (!run) throw new NotFoundException('run not found');
    let attempts = await this.prisma.callAttempt.findMany({
      where: { tenantId, campaignId, runId },
      orderBy: { startedAt: 'asc' },
    });
    if (!attempts.length) {
      // Legacy rows (no runId): runs never overlap per campaign, so the run's
      // start/end window identifies its calls. Small grace for clock skew between
      // an item finishing and the summary row being written.
      const grace = 5_000;
      attempts = await this.prisma.callAttempt.findMany({
        where: {
          tenantId, campaignId, runId: null,
          startedAt: {
            gte: new Date(+new Date(run.startedAt) - grace),
            lte: new Date(+new Date(run.endedAt) + grace),
          },
        },
        orderBy: { startedAt: 'asc' },
      });
    }
    // One row per number (the latest attempt), mirroring the Monitor's items list.
    const byNumber = new Map<string, (typeof attempts)[number]>();
    for (const a of attempts) {
      const prev = byNumber.get(a.number);
      if (!prev || (a.attempt ?? 1) >= (prev.attempt ?? 1)) byNumber.set(a.number, a);
    }
    const items = [...byNumber.values()].map((a) => ({
      number: a.number, status: a.status, attempts: a.attempt ?? 1,
      cause: a.cause, disposition: a.disposition, agent: a.agent,
      recording: a.recording, startedAt: a.startedAt,
    }));
    return { run, items };
  }

  /** How many distinct contacts a campaign currently targets from its live source
   *  (pasted numbers + lead group + contact group; contactGroupId '*' = all of the
   *  tenant's contacts). This is the source of truth for the "Contacts" column so
   *  editing the target updates the count without re-materialising leads. */
  private async sourceContactsCount(tenantId: string, campaign: any): Promise<number> {
    const nums = this.parseNumbers(campaign.numbers);
    const groupCount = campaign.leadGroupId
      ? await this.prisma.lead.count({ where: { tenantId, leadGroupId: campaign.leadGroupId } })
      : 0;
    let contactGroupCount = 0;
    if (campaign.contactGroupId) {
      const where = campaign.contactGroupId === '*'
        ? { tenantId, phone: { not: null } }
        : { tenantId, groupIds: { has: campaign.contactGroupId }, phone: { not: null } };
      contactGroupCount = await this.prisma.contact.count({ where });
    }
    return nums.length + groupCount + contactGroupCount;
  }

  /** Fields that define WHO a campaign calls. Changing any of them invalidates the
   *  campaign's materialised leads so the next run/preview rebuilds from the new
   *  source (otherwise ensureLeads short-circuits and keeps dialing the old list). */
  private static readonly TARGETING_FIELDS = ['numbers', 'leadGroupId', 'contactGroupId'];

  /** Update a campaign; if its targeting changed, drop stale materialised leads so
   *  they re-materialise from the new source. Leads are left alone while a run is
   *  live (that run works off its own in-memory item list). */
  async updateCampaign(tenantId: string, id: string, data: any) {
    const before = await this.prisma.outboundCampaign.findFirst({ where: { id, tenantId } });
    if (!before) throw new NotFoundException('campaign not found');
    const { id: _i, tenantId: _t, createdAt, updatedAt, ...patch } = data ?? {};
    await this.prisma.outboundCampaign.updateMany({ where: { id, tenantId }, data: patch });

    const targetingChanged = DialerService.TARGETING_FIELDS.some(
      (f) => f in patch && (patch as any)[f] !== (before as any)[f],
    );
    const run = this.runs.get(id);
    const runLive = run && !DONE_STATES.has(run.status);
    if (targetingChanged && !runLive) {
      const { count } = await this.prisma.lead.deleteMany({ where: { tenantId, campaignId: id } });
      if (count) this.logger.log(`campaign ${id} targeting changed; cleared ${count} stale leads`);
    }
    return this.prisma.outboundCampaign.findFirst({ where: { id, tenantId } });
  }

  /** Clone a campaign's config into a new (paused) campaign with a fresh, empty
   *  lead set — the original stays untouched as immutable history. */
  async duplicateCampaign(tenantId: string, id: string) {
    const c = await this.prisma.outboundCampaign.findFirst({ where: { id, tenantId } });
    if (!c) throw new NotFoundException('campaign not found');
    const { id: _id, createdAt, updatedAt, ...rest } = c as any;
    return this.prisma.outboundCampaign.create({
      data: { ...rest, name: `${c.name} (copy)`, active: false },
    });
  }

  /** Re-open a campaign for a fresh run: clear its leads' working state (status /
   *  last disposition / attempts) so every lead is dialable again. Call history
   *  (CallLog / CallAttempt) is left intact — the audit trail survives. */
  async resetCampaignProgress(tenantId: string, id: string) {
    const c = await this.prisma.outboundCampaign.findFirst({ where: { id, tenantId } });
    if (!c) throw new NotFoundException('campaign not found');
    const run = this.runs.get(id);
    if (run && !DONE_STATES.has(run.status)) {
      throw new BadRequestException('stop the active run before resetting this campaign');
    }
    const { count } = await this.prisma.lead.updateMany({
      where: { tenantId, campaignId: id },
      data: { status: 'new', lastDisposition: null, attempts: 0 },
    });
    return { ok: true, reset: count };
  }

  // ---------- lead materialisation + re-run eligibility (iCallify lead status) ----------

  /** Create the campaign's working leads from its source (pasted numbers + lead
   *  group + contact group; '*' = all contacts) the first time it's worked. No-op
   *  once leads exist. Shared shape with the Preview flow's ensureLeads. */
  private async materializeLeads(tenantId: string, campaign: any) {
    const existing = await this.prisma.lead.count({ where: { tenantId, campaignId: campaign.id } });
    if (existing > 0) return;
    const rows: { tenantId: string; campaignId: string; phone: string; name?: string | null; status: string; extra?: any }[] = [];
    for (const phone of parseNumbers(campaign.numbers)) rows.push({ tenantId, campaignId: campaign.id, phone, status: 'new' });
    if (campaign.leadGroupId) {
      const group = await this.prisma.lead.findMany({ where: { tenantId, leadGroupId: campaign.leadGroupId } });
      for (const l of group) rows.push({ tenantId, campaignId: campaign.id, phone: l.phone, name: l.name, status: 'new', extra: l.extra });
    }
    if (campaign.contactGroupId) {
      const where = campaign.contactGroupId === '*'
        ? { tenantId }
        : { tenantId, groupIds: { has: campaign.contactGroupId } };
      const contacts = await this.prisma.contact.findMany({ where });
      // Carry the contact's custom-field values onto the lead so they're available
      // during the call and in the CDR.
      for (const c of contacts) if (c.phone) rows.push({ tenantId, campaignId: campaign.id, phone: c.phone, name: c.name, status: 'new', extra: c.customFields });
    }
    const seen = new Set<string>();
    const dedup = rows.filter((r) => (seen.has(r.phone) ? false : (seen.add(r.phone), true)));
    if (dedup.length) await this.prisma.lead.createMany({ data: dedup });
  }

  /** Names of the dispositions the campaign marked "don't re-dial on a re-run". */
  private async excludeDispositionNames(tenantId: string, campaign: any): Promise<Set<string>> {
    const ids: string[] = campaign.excludeDispositionIds ?? [];
    if (!ids.length) return new Set();
    // Stored values may be disposition ids or (fallback) names — resolve either to
    // the canonical name we compare Lead.lastDisposition against.
    const rows = await this.prisma.disposition.findMany({
      where: { tenantId, OR: [{ id: { in: ids } }, { name: { in: ids } }] },
      select: { name: true },
    });
    return new Set(rows.map((r) => r.name));
  }

  /** The leads a run should work now: materialised, not DNC/reserved, and whose
   *  last disposition isn't in the campaign's exclude set (empty disposition =
   *  never finished, so it's always eligible). */
  private async workableLeads(tenantId: string, campaign: any) {
    await this.materializeLeads(tenantId, campaign);
    const excluded = await this.excludeDispositionNames(tenantId, campaign);
    const leads = await this.prisma.lead.findMany({
      where: { tenantId, campaignId: campaign.id, status: { notIn: ['dnc', 'dialing'] } },
      orderBy: { createdAt: 'asc' },
    });
    return leads.filter((l) => !l.lastDisposition || !excluded.has(l.lastDisposition));
  }

  /** Map a disposition to what it means for the lead, by the disposition's
   *  category. Mirrors the Preview flow so both dial modes agree. */
  private async leadOutcome(tenantId: string, disposition?: string | null): Promise<'retry' | 'dnc' | 'done'> {
    if (!disposition) return 'done';
    const row = await this.prisma.disposition.findFirst({ where: { tenantId, name: disposition } });
    const cat = (row?.category || '').toLowerCase();
    if (cat === 'dnc') return 'dnc';
    if (cat === 'retry' || cat === 'callback') return 'retry';
    return 'done';
  }

  /** Apply an agent's disposition to a live/just-ended campaign call: update the
   *  lead (status + lastDisposition, so re-runs can exclude it), annotate the most
   *  recent call log for that number, and reflect it on the in-memory run item.
   *  Works whether or not the run is still in memory. */
  async dispositionCall(tenantId: string, campaignId: string, number: string, disposition: string, notes?: string) {
    const campaign = await this.prisma.outboundCampaign.findFirst({ where: { id: campaignId, tenantId } });
    if (!campaign) throw new NotFoundException('campaign not found');
    const disp = String(disposition ?? '').slice(0, 60);
    const dialed = digits(number);

    // Find the lead by phone (compare on trailing digits to survive +234/0 forms).
    const leads = await this.prisma.lead.findMany({ where: { tenantId, campaignId } });
    const lead = leads.find((l) => digits(l.phone).endsWith(dialed.slice(-9)) || dialed.endsWith(digits(l.phone).slice(-9)));
    if (lead && disp) {
      const outcome = await this.leadOutcome(tenantId, disp);
      const retryable = outcome === 'retry' && lead.attempts < Math.max(1, campaign.maxAttempts);
      await this.prisma.lead.update({
        where: { id: lead.id },
        data: { status: outcome === 'dnc' ? 'dnc' : retryable ? 'new' : 'done', lastDisposition: disp },
      });
    }

    // Annotate the latest call log for this number in this campaign, if any. The
    // recording is captured server-side (on the CallAttempt) under a name the
    // browser that created the log never knew — copy it over so it's playable.
    const log = await this.prisma.callLog.findFirst({
      where: { tenantId, campaignId, peerNumber: { endsWith: dialed.slice(-9) } },
      orderBy: { startedAt: 'desc' },
    });
    if (log) {
      const att = await this.prisma.callAttempt.findFirst({
        where: { tenantId, campaignId, number: { endsWith: dialed.slice(-9) }, recording: { not: null } },
        orderBy: { startedAt: 'desc' },
      });
      await this.prisma.callLog.update({
        where: { id: log.id },
        data: { disposition: disp || null, notes: notes ?? log.notes, recording: att?.recording ?? log.recording },
      });
    }

    // Reflect on the in-memory run item so the live monitor shows it immediately.
    const run = this.runs.get(campaignId);
    const item = run?.items.find((i) => digits(i.number).endsWith(dialed.slice(-9)));
    if (item) item.disposition = disp || item.disposition;
    return { ok: true, lead: lead?.id ?? null };
  }

  // The numbers/leads inside a campaign — for the campaign detail view. Once the
  // campaign has been worked, returns the materialised Lead rows (with status /
  // attempts / last disposition); before that, the configured source numbers.
  async campaignLeads(tenantId: string, campaignId: string) {
    const campaign = await this.prisma.outboundCampaign.findFirst({ where: { id: campaignId, tenantId } });
    if (!campaign) throw new NotFoundException('campaign not found');
    const leads = await this.prisma.lead.findMany({ where: { tenantId, campaignId }, orderBy: { createdAt: 'asc' } });
    if (leads.length) return { campaign, materialized: true, leads };
    const nums = Array.from(new Set(
      (campaign.numbers || '').split(/[\s,;\n]+/).map((s) => s.trim()).filter((s) => /\d{3,}/.test(s)),
    ));
    const groupLeads = campaign.leadGroupId
      ? await this.prisma.lead.findMany({ where: { tenantId, leadGroupId: campaign.leadGroupId } })
      : [];
    const groupContacts = campaign.contactGroupId
      ? await this.prisma.contact.findMany({ where: { tenantId, groupIds: { has: campaign.contactGroupId } } })
      : [];
    const preview = [
      ...nums.map((phone) => ({ id: null, phone, name: null, status: 'new', attempts: 0, lastDisposition: null })),
      ...groupLeads.map((l) => ({ id: l.id, phone: l.phone, name: l.name, status: 'new', attempts: 0, lastDisposition: null })),
      ...groupContacts.filter((c) => c.phone).map((c) => ({ id: c.id, phone: c.phone, name: c.name, status: 'new', attempts: 0, lastDisposition: null })),
    ];
    return { campaign, materialized: false, leads: preview };
  }

  /** Full call history for a campaign: agent-connected CallLogs (with disposition,
   *  notes, recording) UNIONed with the failed/unconnected CallAttempts that never
   *  produced a log (e.g. SUBSCRIBER_ABSENT) — so every dial shows up, not just the
   *  ones that reached an agent. */
  async campaignCalls(tenantId: string, campaignId: string) {
    const campaign = await this.prisma.outboundCampaign.findFirst({ where: { id: campaignId, tenantId } });
    if (!campaign) throw new NotFoundException('campaign not found');
    const [logs, attempts, accounts, contactsAll] = await Promise.all([
      this.prisma.callLog.findMany({ where: { tenantId, campaignId }, orderBy: { startedAt: 'desc' }, take: 500 }),
      // Terminal attempts that never connected to an agent (no CallLog exists for
      // them). Exclude transient states (queued/dialing retries) — only final
      // non-connected outcomes: failed / skipped / stopped.
      this.prisma.callAttempt.findMany({
        where: { tenantId, campaignId, status: { in: ['failed', 'skipped', 'stopped', 'no-answer'] } },
        orderBy: { startedAt: 'desc' }, take: 500,
      }),
      this.prisma.account.findMany({ where: { tenantId, agentExtension: { not: null } }, select: { agentExtension: true, firstName: true, lastName: true, email: true } }),
      this.prisma.contact.findMany({ where: { tenantId }, select: { id: true, name: true, phone: true } }),
    ]);
    const byExt = new Map(accounts.map((a) => [a.agentExtension!, [a.firstName, a.lastName].filter(Boolean).join(' ') || a.email]));
    const contactById = new Map(contactsAll.map((c) => [c.id, c.name]));
    const d9 = (s?: string | null) => (s || '').replace(/\D/g, '').slice(-9);
    const contactByPhone = new Map(contactsAll.filter((c) => c.phone).map((c) => [d9(c.phone), c.name]));

    const logRows = logs.map((l) => ({
      id: l.id, kind: 'log' as const, number: l.peerNumber,
      name: l.contactId ? contactById.get(l.contactId) ?? null : contactByPhone.get(d9(l.peerNumber)) ?? null,
      agent: l.agentExt ? byExt.get(l.agentExt) ?? null : null,
      startedAt: l.startedAt, durationSec: l.durationSec, status: l.status,
      disposition: l.disposition, notes: l.notes as string | null, recording: l.recording, cause: null as string | null,
    }));
    const attRows = attempts.map((a) => ({
      id: `att_${a.id}`, kind: 'attempt' as const, number: a.number,
      name: contactByPhone.get(d9(a.number)) ?? null,
      agent: null as string | null,
      startedAt: a.startedAt, durationSec: a.durationSec ?? 0, status: a.status,
      disposition: a.disposition, notes: null as string | null, recording: a.recording, cause: a.cause,
    }));
    const calls = [...logRows, ...attRows].sort((x, y) => +new Date(y.startedAt) - +new Date(x.startedAt));

    const counts = {
      total: calls.length,
      answered: logs.filter((l) => l.status === 'completed').length,
      dispositioned: calls.filter((c) => c.disposition).length,
      recorded: calls.filter((c) => c.recording).length,
    };
    return { campaign: { id: campaign.id, name: campaign.name }, counts, calls };
  }

  /** Map of dialed-number (digits) -> its campaign context, for calls currently in
   *  flight. Lets the live dashboard label a FreeSWITCH channel with the campaign
   *  and queue it belongs to. */
  liveDialingContext(tenantId?: string): Record<string, { campaign: string; queue: string | null; agents: string[] }> {
    const out: Record<string, { campaign: string; queue: string | null; agents: string[] }> = {};
    for (const r of this.runs.values()) {
      if (tenantId && r.tenantId !== tenantId) continue;
      if (DONE_STATES.has(r.status)) continue; // finished run — nothing live
      for (const it of r.items) {
        // Only calls actively ringing out. 'answered' is terminal in the dialer
        // (the live bridged call is tracked by FreeSWITCH's `show calls` instead),
        // so including it here would leave stale "ringing" rows after a run ends.
        if (it.status === 'dialing') {
          out[digits(it.number)] = { campaign: r.name, queue: r.queue, agents: r.joinedAgents };
        }
      }
    }
    return out;
  }

  /** ACD queues of all live runs (for counting real queue-waiting customers). */
  activeQueues(tenantId?: string): string[] {
    const qs = new Set<string>();
    for (const r of this.runs.values()) {
      if (tenantId && r.tenantId !== tenantId) continue;
      if (DONE_STATES.has(r.status) || !r.queue) continue;
      qs.add(r.queue);
    }
    return [...qs];
  }

  /** Summaries of all in-memory runs (for the real-time dashboard). */
  listRuns(tenantId?: string) {
    const count = (items: RunItem[], s: ItemStatus) => items.filter((i) => i.status === s).length;
    return [...this.runs.values()]
      .filter((r) => !tenantId || r.tenantId === tenantId)
      .map((r) => ({
        campaignId: r.campaignId, name: r.name, mode: r.mode, status: r.status,
        total: r.items.length,
        answered: count(r.items, 'answered'),
        failed: count(r.items, 'failed'),
        skipped: count(r.items, 'skipped'),
        pending: count(r.items, 'queued') + count(r.items, 'dialing'),
      }));
  }


  /**
   * An agent "plays in" to a campaign: attach them to the campaign's queue tier
   * so answered calls can bridge to them, and start the dialer loop if it isn't
   * already running. Participation is agent-driven (agents join/leave for breaks);
   * the campaign being `active` is the admin gate. No admin blast-start.
   */
  async agentJoin(tenantId: string, campaignId: string, accountId: string, agentExt: string | null): Promise<Run> {
    const campaign = await this.prisma.outboundCampaign.findFirst({ where: { id: campaignId, tenantId } });
    if (!campaign) throw new NotFoundException('campaign not found');
    if (!campaign.active) throw new BadRequestException('this campaign is paused');
    if (!/progressive|power|predict/i.test(campaign.dialMethod || '')) throw new BadRequestException('this campaign is not agent-dialed');
    if (!(campaign.assignedAgentIds ?? []).includes(accountId)) throw new BadRequestException('you are not assigned to this campaign');
    if (!agentExt) throw new BadRequestException('your account has no extension');

    let run = this.runs.get(campaignId);
    const fresh = !run || DONE_STATES.has(run.status);
    this.tr(campaignId, `JOIN ext=${agentExt} fresh=${fresh} existingRunStatus=${run?.status ?? 'none'} roster=[${run?.joinedAgents.join(',') ?? ''}]`);
    if (fresh) run = await this.startRun(tenantId, campaign);
    // Tier the agent in BEFORE the dial loop starts, so answered calls have an
    // agent to bridge to. Starting the loop first would fire a blocking
    // `originate` that holds the single ESL connection and starves this add.
    await this.tierAddAgent(run!, agentExt);
    // tierAddAgent is best-effort and swallows ESL failures (e.g. the FreeSWITCH
    // link is down). If it couldn't actually attach us, don't leave a ghost run
    // idling with an empty roster and report a false success — surface a clear
    // error so the Console shows it instead of a mysterious "taken off".
    if (!run!.joinedAgents.includes(agentExt)) {
      this.tr(campaignId, `JOIN ext=${agentExt} FAILED tier-add (not in roster) — aborting`);
      if (fresh) this.runs.delete(campaignId);
      throw new BadRequestException('Could not join the campaign — the telephony service is unavailable. Please try again in a moment.');
    }
    this.tr(campaignId, `JOIN ext=${agentExt} OK roster=[${run!.joinedAgents.join(',')}] willStartLoop=${fresh}`);
    if (fresh) this.beginLoop(run!, campaign);
    return run!;
  }

  /** An agent takes a break / logs off the campaign: detach their tier. When the
   *  last agent leaves, the dialer loop winds down. */
  async agentLeave(tenantId: string, campaignId: string, agentExt: string | null): Promise<{ ok: boolean; joined: string[] }> {
    const run = this.runs.get(campaignId);
    if (!run || !agentExt) return { ok: true, joined: run?.joinedAgents ?? [] };
    this.tr(campaignId, `LEAVE ext=${agentExt} rosterBefore=[${run.joinedAgents.join(',')}]`);
    await this.tierDelAgent(run, agentExt);
    if (!run.joinedAgents.length && run.status === 'running') { run.status = 'stopping'; this.tr(campaignId, `last agent left -> stopping`); }
    return { ok: true, joined: run.joinedAgents };
  }

  /** Create the run and start the dialing loop (queue loaded, no tiers yet — agents
   *  add themselves via agentJoin). */
  private async startRun(tenantId: string, campaign: any): Promise<Run> {
    const campaignId = campaign.id;

    // Don't start outside the campaign's schedule / daily call window.
    const block = scheduleBlockReason(campaign);
    if (block) throw new BadRequestException(`Can't dial now: ${block}.`);

    const dnc = new Set((await this.prisma.dnc.findMany({ where: { tenantId } })).map((d) => digits(d.number)));

    // Agent modes (progressive/power/predictive) connect answered calls to a live
    // agent via a dedicated per-campaign ACD queue (served to FreeSWITCH over
    // xml_curl, loaded on demand at run start); voice-broadcast just plays audio.
    const method = campaign.dialMethod || '';
    const agentMode = /progressive|power|predict/i.test(method);
    const queue = agentMode ? `cc-${campaign.id}@default` : null;

    const mkItem = (number: string, leadId: string | null): RunItem =>
      dnc.has(digits(number))
        ? { number, status: 'skipped', attempts: 0, cause: 'On DNC list', disposition: 'Do Not Call', agent: null, recording: null, leadId }
        : { number, status: 'queued', attempts: 0, cause: null, disposition: null, agent: null, recording: null, leadId };

    let items: RunItem[];
    if (agentMode) {
      // Work the campaign's materialised leads, skipping any whose last disposition
      // the admin marked "don't re-dial" (the iCallify lead-status model). A fresh
      // lead has no disposition, so the first run works everything; later runs only
      // pick up leads still lacking a terminal/excluded disposition.
      const leads = await this.workableLeads(tenantId, campaign);
      const seen = new Set<string>();
      items = [];
      for (const l of leads) {
        const number = normalizePlus(l.phone);
        if (!number || seen.has(number)) continue;
        seen.add(number);
        items.push(mkItem(number, l.id));
      }
      if (!items.length) throw new BadRequestException('no leads left to dial — every lead already has an excluded disposition');
    } else {
      // Broadcast: dial straight from the source numbers (no per-lead tracking).
      let numbers = parseNumbers(campaign.numbers);
      if (campaign.leadGroupId) {
        const leads = await this.prisma.lead.findMany({ where: { tenantId, leadGroupId: campaign.leadGroupId } });
        numbers = numbers.concat(leads.map((l) => l.phone));
      }
      if (campaign.contactGroupId) {
        const where = campaign.contactGroupId === '*'
          ? { tenantId }
          : { tenantId, groupIds: { has: campaign.contactGroupId } };
        const contacts = await this.prisma.contact.findMany({ where, select: { phone: true } });
        numbers = numbers.concat(contacts.map((c) => c.phone).filter(Boolean) as string[]);
      }
      numbers = [...new Set(numbers.map(normalizePlus))].filter(Boolean);
      if (!numbers.length) throw new BadRequestException('campaign has no valid phone numbers');
      items = numbers.map((n) => mkItem(n, null));
    }

    const run: Run = {
      runId: randomUUID(),
      campaignId,
      tenantId,
      name: campaign.name,
      mode: agentMode ? 'agent' : 'broadcast',
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      note: null,
      queue,
      queueLoaded: false,
      tiers: [],
      joinedAgents: [],
      items,
      bridged: 0,
      abandoned: 0,
      bridgedMembers: new Set(),
      ratio: clampNum(campaign.overdialRatio, 1, MAX_OVERDIAL_RATIO, 1),
    };
    this.runs.set(campaignId, run);
    // Load this campaign's dedicated ACD queue up front (agents tier in on join).
    if (run.mode === 'agent' && run.queue) await this.loadQueue(run);
    // Record DNC-skipped numbers up front so reports reflect them.
    for (const it of run.items) if (it.status === 'skipped') await this.persist(run, it).catch(() => {});
    // NB: the dial loop is NOT started here. For agent modes the caller must tier
    // in the first agent first (see agentJoin), then call beginLoop — otherwise
    // the loop's blocking `originate` would hold the single ESL connection and
    // starve the tier-add, and the answered call would land in an empty queue.
    return run;
  }

  /** Kick off the (async) dial loop for a run. Call only after the first agent is
   *  tiered in, so answered calls have somewhere to bridge. */
  private beginLoop(run: Run, campaign: any) {
    this.loop(run, campaign).catch((err) => {
      run.status = 'error';
      run.finishedAt = new Date().toISOString();
      this.logger.error(`dial loop failed: ${err.message}`);
    });
  }

  stop(campaignId: string): Run {
    const run = this.runs.get(campaignId);
    if (!run) throw new NotFoundException('no active run for this campaign');
    if (run.status === 'running') run.status = 'stopping';
    return run;
  }

  async setDisposition(tenantId: string, campaignId: string, number: string, disposition: string) {
    const run = this.runs.get(campaignId);
    if (!run) throw new NotFoundException('no run for this campaign');
    const item = run.items.find((i) => i.number === number);
    if (!item) throw new NotFoundException('number not in this run');
    item.disposition = String(disposition ?? '').slice(0, 60) || null;
    await this.prisma.callAttempt.updateMany({
      where: { tenantId, campaignId, number },
      data: { disposition: item.disposition },
    });
    return item;
  }

  private async loop(run: Run, campaign: any) {
    const maxAttempts = clampInt(campaign.maxAttempts, 1, 10, 1);
    // Progressive paces by free agents; power/predictive over-dial by concurrency;
    // everything else is one-at-a-time.
    const method = campaign.dialMethod || '';
    const progressive = /progressive/i.test(method) && run.mode === 'agent';
    // Power/Predictive both over-dial by ratio × free agents. Power holds a fixed
    // ratio; Predictive re-derives it live each tick from the run's answer/abandon
    // rates (computePredictiveRatio), keeping the abandon rate under target.
    const overdial = /power|predict/i.test(method) && run.mode === 'agent';
    const predictive = /predict/i.test(method) && run.mode === 'agent';
    const abandonTargetPct = clampNum(campaign.abandonTargetPct, 0.5, 20, 3);
    let curRatio = overdial ? clampNum(campaign.overdialRatio, 1, MAX_OVERDIAL_RATIO, 1) : 1;
    let concurrency = /progressive|power|predict|auto/i.test(method)
      ? clampInt(campaign.concurrency, 1, MAX_CONCURRENCY, 1)
      : 1;
    // Enforce the tenant's plan limit on concurrent calls (Phase 5 SaaS limits).
    const tenant = await this.prisma.tenant.findUnique({ where: { id: run.tenantId }, include: { plan: true } });
    const maxCC = Number((tenant?.limits as any)?.maxConcurrentCalls ?? (tenant?.plan?.limits as any)?.maxConcurrentCalls);
    if (Number.isFinite(maxCC) && maxCC > 0) concurrency = Math.min(concurrency, maxCC);

    const pending = run.items.map((it, i) => (it.status === 'queued' ? i : -1)).filter((i) => i >= 0);
    let next = 0;
    let lastFree = -1;
    const active = new Set<Promise<void>>();
    this.tr(run.campaignId, `LOOP start pending=${pending.length} progressive=${progressive} concurrency=${concurrency} roster=[${run.joinedAgents.join(',')}]`);

    const launch = async (idx: number) => {
      const item = run.items[idx];
      item.status = 'dialing';
      item.attempts++;
      this.tr(run.campaignId, `DIAL start number=${item.number} attempt=${item.attempts}`);
      if (item.leadId) this.prisma.lead.update({ where: { id: item.leadId }, data: { attempts: { increment: 1 } } }).catch(() => {});
      const res = await this.dialOne(item.number, campaign, run.queue);
      if (res.ok) {
        item.status = 'answered';
        item.cause = res.cause;
        item.agent = run.queue;
        item.disposition = item.disposition || campaign.successDisposition || 'Answered';
        if (campaign.recording) item.recording = res.recording;
      } else if (item.attempts < maxAttempts && retryable(res.cause)) {
        item.status = 'queued';
        item.cause = `${res.cause} (retry ${item.attempts}/${maxAttempts})`;
        pending.push(idx);
      } else {
        item.status = 'failed';
        item.cause = res.cause;
        item.disposition = item.disposition || dispoFor(res.cause);
      }
      this.tr(run.campaignId, `DIAL result number=${item.number} ok=${res.ok} cause=${res.cause} -> status=${item.status}`);
      await this.persist(run, item).catch(() => {});
    };

    let idleChecks = 0;
    try {
    while (next < pending.length || active.size) {
      if (run.status === 'stopping') break;
      // If the call window closes mid-run, stop launching new calls (let the
      // in-flight ones finish) and record why.
      const block = scheduleBlockReason(campaign);
      if (block) { run.status = 'stopping'; run.note = `Paused: ${block}`; break; }
      // The loop winds down when the last agent leaves (agentLeave sets
      // 'stopping'); until then, an empty roster just idle-waits below — so a
      // brand-new run doesn't stop before its first agent's tier is attached.

      // How many new calls we may start this tick. Progressive: one per free
      // *joined* agent (Available+Waiting, minus calls already in flight that
      // each claim one). Power/broadcast: up to the concurrency cap.
      let slots: number;
      if (progressive) {
        // Only dial when a joined agent is actually free. An empty roster means
        // nobody has played in (or all are on break) — hold, don't dial into an
        // agentless queue. (availableAgents counts ALL agents for an empty set,
        // so we must guard the empty case explicitly.)
        const free = run.joinedAgents.length ? await this.availableAgents(new Set(run.joinedAgents)) : 0;
        // Trace when readiness changes: shows exactly when (and why) a joined agent
        // is/isn't ready to receive a call.
        if (free !== lastFree) {
          this.tr(run.campaignId, `READY free=${free} agents=[${this.lastReadiness}] pending=${pending.length - next} active=${active.size}`);
          lastFree = free;
        }
        slots = Math.min(concurrency - active.size, Math.max(0, free - active.size));
      } else if (overdial) {
        // Over-dial: dial ratio × free agents, minus what's already ringing/waiting,
        // capped by concurrency. Same empty-roster guard as progressive.
        const free = run.joinedAgents.length ? await this.availableAgents(new Set(run.joinedAgents)) : 0;
        const waiting = await this.queueWaitingCount(run.queue);
        if (predictive) {
          // Re-derive the ratio from live outcomes: dials that resolved, of which
          // connected (answered) vs abandoned. The controller nudges curRatio.
          const dialed = run.items.filter((it) => it.status === 'answered' || it.status === 'failed').length;
          const answered = run.items.filter((it) => it.status === 'answered').length;
          const newR = computePredictiveRatio({ dialed, answered, abandoned: run.abandoned, prevRatio: curRatio, targetAbandonPct: abandonTargetPct, maxRatio: MAX_OVERDIAL_RATIO });
          if (Math.abs(newR - curRatio) >= 0.01) {
            this.tr(run.campaignId, `PREDICT ratio ${curRatio.toFixed(2)}->${newR.toFixed(2)} dialed=${dialed} answered=${answered} abandoned=${run.abandoned} targetA=${abandonTargetPct}%`);
          }
          curRatio = newR;
        }
        run.ratio = curRatio; // surface the live ratio on the run pulse
        slots = computeOverdialSlots({ free, dialing: active.size, waiting, ratio: curRatio, cap: concurrency });
        if (free !== lastFree) {
          this.tr(run.campaignId, `READY(${predictive ? 'predict' : 'power'}) free=${free} waiting=${waiting} ratio=${curRatio.toFixed(2)} slots=${slots} agents=[${this.lastReadiness}] pending=${pending.length - next} active=${active.size}`);
          lastFree = free;
        }
      } else {
        slots = concurrency - active.size;
      }

      let launchedThisTick = 0;
      while (slots > 0 && next < pending.length) {
        const idx = pending[next++];
        if (run.items[idx].status !== 'queued') continue;
        const p = launch(idx).finally(() => active.delete(p));
        active.add(p);
        slots--; launchedThisTick++;
      }

      if (active.size) {
        await Promise.race(active);
      } else if ((progressive || overdial) && next < pending.length && !launchedThisTick) {
        // Joined agents are all busy/on-break — idle-wait for one to free up.
        // Periodically re-check that the campaign is still active (admin pause).
        if (++idleChecks % 8 === 0) {
          const c = await this.prisma.outboundCampaign.findUnique({ where: { id: run.campaignId }, select: { active: true } });
          if (!c?.active) { run.status = 'stopping'; run.note = 'Paused: campaign was deactivated'; break; }
        }
        await sleep(AGENT_POLL_MS);
      }
    }
    await Promise.allSettled(active);
    // An answered call's `originate &callcenter` returns +OK when the CUSTOMER
    // picks up (enters the ACD queue) — the agent bridge happens a few seconds
    // LATER, inside FreeSWITCH. Once leads are exhausted we must NOT tear the
    // tier down until the queue has drained, or the last answered call gets
    // pulled out of the queue mid-bridge (BREAK_OUT) and never reaches an agent.
    await this.drainQueue(run);
    } finally {
      // Always detach this run's agents from the ACD queue, even on error
      // (leave any pre-existing tiers untouched — we only remove what we added).
      await this.unwireQueue(run);
    }

    if (run.status === 'stopping') {
      run.status = 'stopped';
      for (const it of run.items) if (it.status === 'queued' || it.status === 'dialing') it.status = 'stopped';
    } else {
      run.status = 'done';
    }
    run.finishedAt = new Date().toISOString();
    this.tr(run.campaignId, `RUN END status=${run.status}`);
    await this.persistRunSummary(run, campaign.dialMethod || '').catch(() => {});
  }

  /** Write a durable summary of a finished run so campaign history + lifetime
   *  abandon rate survive after the in-memory run is gone. */
  private async persistRunSummary(run: Run, dialMethod: string) {
    const cnt = (s: ItemStatus) => run.items.filter((i) => i.status === s).length;
    const dialed = run.items.filter((i) => (i.attempts ?? 0) > 0).length;
    await this.prisma.campaignRun.create({
      data: {
        id: run.runId, // matches the runId stamped on this run's CallAttempts
        tenantId: run.tenantId,
        campaignId: run.campaignId,
        dialMethod: dialMethod || run.mode,
        status: run.status,
        startedAt: new Date(run.startedAt),
        endedAt: run.finishedAt ? new Date(run.finishedAt) : new Date(),
        dialed,
        connected: cnt('answered'),
        bridged: run.bridged,
        abandoned: run.abandoned,
        failed: cnt('failed'),
      },
    });
  }

  /** Load this campaign's dedicated queue on demand (served over xml_curl). */
  private async loadQueue(run: Run) {
    if (!run.queue || run.queueLoaded) return;
    try {
      // `load` creates the queue on first use. If it already exists (a prior run
      // left it loaded), `load` returns -ERR, so `reload` re-reads its params from
      // xml_curl — this is what makes config changes (e.g. max-wait) take effect.
      const res = String(await this.fs.api(`callcenter_config queue load ${run.queue}`)).trim();
      if (/^-ERR/.test(res)) {
        const rl = String(await this.fs.api(`callcenter_config queue reload ${run.queue}`)).trim();
        if (/^-ERR/.test(rl)) { this.logger.warn(`queue load/reload ${run.queue}: ${res} / ${rl}`); return; }
      }
      run.queueLoaded = true;
    } catch (e: any) { this.logger.warn(`queue load ${run.queue} failed: ${e?.message}`); }
  }

  /** Resolve the mod_callcenter agent name (e.g. 1002@102.209.224.37) for an ext. */
  private async agentNameForExt(ext: string): Promise<string | null> {
    let agents = '';
    try { agents = await this.fs.api('callcenter_config agent list'); } catch { return null; }
    for (const line of agents.split('\n')) {
      const cols = line.split('|');
      if (cols.length < 7 || cols[0] === 'name') continue;
      const e = (cols[4] || '').trim().replace(/^user\//, '').split('@')[0];
      if (e === ext) return cols[0].trim();
    }
    return null;
  }

  /** Add a single agent (by ext) to the run's queue tier + mark them joined. */
  private async tierAddAgent(run: Run, ext: string) {
    if (!run.queue) return;
    if (run.joinedAgents.includes(ext)) { this.tr(run.campaignId, `tierAdd ext=${ext} already in roster`); return; }
    const name = await this.agentNameForExt(ext);
    if (!name) { this.tr(run.campaignId, `tierAdd ext=${ext} FAIL: no callcenter agent found`); this.logger.warn(`join: no callcenter agent for ext ${ext}`); return; }
    try {
      const res = String(await this.fs.api(`callcenter_config tier add ${run.queue} ${name} 1 1`)).trim();
      if (/^-ERR/.test(res) && !/exist/i.test(res)) { this.tr(run.campaignId, `tierAdd ext=${ext} FAIL: ${res}`); this.logger.warn(`tier add ${name} -> ${run.queue}: ${res}`); return; }
      await this.fs.api(`callcenter_config agent set status ${name} 'Available'`).catch(() => {});
      run.tiers.push({ queue: run.queue, agent: name, ext });
      run.joinedAgents.push(ext);
      this.tr(run.campaignId, `tierAdd ext=${ext} name=${name} OK (tier add: ${res})`);
      this.logger.log(`ext ${ext} joined ${run.queue} (campaign ${run.campaignId})`);
    } catch (e: any) { this.tr(run.campaignId, `tierAdd ext=${ext} EXCEPTION ${e?.message}`); this.logger.warn(`tier add ${name} failed: ${e?.message}`); }
  }

  /** Remove a single agent (by ext) from the run's queue tier + mark them left. */
  private async tierDelAgent(run: Run, ext: string) {
    const idx = run.tiers.findIndex((t) => t.ext === ext);
    if (idx >= 0) {
      const t = run.tiers[idx];
      try { await this.fs.api(`callcenter_config tier del ${t.queue} ${t.agent}`); }
      catch (e: any) { this.logger.warn(`tier del ${t.agent} failed: ${e?.message}`); }
      run.tiers.splice(idx, 1);
    }
    run.joinedAgents = run.joinedAgents.filter((e) => e !== ext);
    this.tr(run.campaignId, `tierDel ext=${ext} roster=[${run.joinedAgents.join(',')}]`);
    this.logger.log(`ext ${ext} left ${run.queue} (campaign ${run.campaignId})`);
  }

  /**
   * Remove every tier this run added, then unload its dedicated queue. Idempotent
   * (the per-campaign queue is only ours; pre-existing tiers are never touched).
   */
  private async unwireQueue(run: Run) {
    const tiers = run.tiers.splice(0);
    this.tr(run.campaignId, `UNWIRE tiers=[${tiers.map((t) => t.ext).join(',')}] queue=${run.queue}`);
    run.joinedAgents = [];
    for (const t of tiers) {
      try { await this.fs.api(`callcenter_config tier del ${t.queue} ${t.agent}`); }
      catch (e: any) { this.logger.warn(`tier del ${t.agent} -> ${t.queue} failed: ${e?.message}`); }
    }
    if (run.queueLoaded && run.queue) {
      run.queueLoaded = false;
      try { await this.fs.api(`callcenter_config queue unload ${run.queue}`); }
      catch (e: any) { this.logger.warn(`queue unload ${run.queue} failed: ${e?.message}`); }
    }
  }

  /** Wait until the run's ACD queue has no members left (all answered calls have
   *  finished bridging + hung up), so teardown doesn't yank a live call out of the
   *  queue. Bounded by QUEUE_DRAIN_MAX_MS so a stuck member can't hang the run. */
  private async drainQueue(run: Run) {
    if (!run.queue || !run.tiers.length) { this.tr(run.campaignId, `drain skip (queue=${run.queue} tiers=${run.tiers.length})`); return; }
    this.tr(run.campaignId, `drain start — holding tier until queue empties`);
    const deadline = Date.now() + QUEUE_DRAIN_MAX_MS;
    while (Date.now() < deadline) {
      if (await this.queueIdle(run)) { this.tr(run.campaignId, `drain done — queue empty`); return; }
      await sleep(AGENT_POLL_MS);
    }
    this.tr(run.campaignId, `drain TIMEOUT after ${QUEUE_DRAIN_MAX_MS}ms`);
    this.logger.warn(`queue ${run.queue} did not drain within ${QUEUE_DRAIN_MAX_MS}ms; tearing down anyway`);
  }

  /** True when no member is in the run's queue (waiting or bridged). A member row
   *  is pipe-delimited; an empty queue replies just `+OK`. */
  private async queueIdle(run: Run): Promise<boolean> {
    if (!run.queue) return true;
    try {
      const out = String(await this.fs.api(`callcenter_config queue list members ${run.queue}`));
      return !out.split('\n').some((l) => l.includes('|'));
    } catch {
      return true; // can't tell → don't hold the run open forever
    }
  }

  /** Answered callers holding in the run's ACD queue for an agent (Waiting/Trying).
   *  Used by Power/Predictive pacing to avoid over-dialing onto a saturated queue. */
  private async queueWaitingCount(queue: string | null): Promise<number> {
    if (!queue) return 0;
    try {
      const out = String(await this.fs.api(`callcenter_config queue list members ${queue}`));
      return out.split('\n').filter((l) => l.includes('|') && /\b(Waiting|Trying)\b/i.test(l)).length;
    } catch {
      return 0;
    }
  }

  /**
   * Count agents ready to take a call right now: mod_callcenter agents whose
   * status is Available and state is Waiting. Scoped to `wanted` extensions when
   * provided (the campaign's assigned agents), else counts every ready agent.
   * De-dupes agents registered under multiple domains (same extension).
   */
  private async availableAgents(wanted: Set<string>): Promise<number> {
    let body: string;
    try { body = await this.fs.api('callcenter_config agent list'); } catch { this.lastReadiness = 'ESL-UNREACHABLE'; return 0; }
    const readyExts = new Set<string>();
    const details: string[] = [];
    for (const line of body.split('\n')) {
      const cols = line.split('|');
      if (cols.length < 7 || cols[0] === 'name') continue; // skip header / short lines
      const ext = (cols[4] || '').trim().replace(/^user\//, '').split('@')[0]; // contact "user/1002" -> "1002"
      if (!ext) continue;
      if (wanted.size && !wanted.has(ext)) continue;
      const status = (cols[5] || '').trim();
      const state = (cols[6] || '').trim();
      if (wanted.size) details.push(`${ext}:${status}/${state}`);
      if (/^Available/i.test(status) && /^Waiting/i.test(state)) readyExts.add(ext);
    }
    // Stash the per-wanted-agent status/state so the loop can trace *why* an agent
    // is or isn't ready (dedupe: an ext registered under two domains lists twice).
    this.lastReadiness = [...new Set(details)].join(' ');
    return readyExts.size;
  }

  /** Originate one call; bridge to the ACD queue (agent mode) or play audio (broadcast). */
  /**
   * Resolve a lead number to a FreeSWITCH dial string + caller id, mirroring the
   * dialplan: an external Nigerian number (national/E.164) routes out via the
   * tenant's trunk normalised to `0<national>` (what the carrier tech-prefix
   * wants); a short internal extension dials `user/<ext>` directly.
   */
  /** Tenant slug, used as the dialplan context when routing the answered customer
   *  leg into the served queue-entry extension. Cached (slugs don't change). */
  private async tenantSlug(tenantId: string): Promise<string> {
    let s = this.slugByTenant.get(tenantId);
    if (s === undefined) {
      const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } });
      s = t?.slug || '';
      this.slugByTenant.set(tenantId, s);
    }
    return s;
  }

  private async resolveDestination(number: string, campaign: any): Promise<{ destination: string; callerId: string | null }> {
    const raw = String(number || '').trim();
    const m = raw.match(/^(?:\+?234|00234|0)?(\d{10})$/);
    if (m) {
      const gw = (campaign.gateway || '').trim();
      const trunk = gw
        ? await this.prisma.trunk.findFirst({ where: { tenantId: campaign.tenantId, name: gw } })
        : await this.prisma.trunk.findFirst({ where: { tenantId: campaign.tenantId, active: true } });
      if (trunk) return { destination: `sofia/gateway/${trunk.name}/0${m[1]}`, callerId: campaign.callerId || trunk.callerId || null };
    }
    return { destination: `user/${raw}`, callerId: campaign.callerId || null };
  }

  private async dialOne(number: string, campaign: any, queue: string | null): Promise<{ ok: boolean; cause: string; recording: string | null }> {
    const { destination, callerId } = await this.resolveDestination(number, campaign);
    const cid = sanitizeCid(callerId);
    // Record to FreeSWITCH's recordings folder. Store just the filename in the
    // DB so the API can locate + stream it back for playback.
    // Unique per call (timestamp) so repeated calls to the same number don't
    // overwrite each other's recording.
    const recFile = campaign.recording ? `ucp_${campaign.id}_${digits(number)}_${Date.now()}.wav` : null;
    const recVar = recFile ? `,execute_on_answer='record_session ${REC_DIR}/${recFile}'` : '';
    const vars =
      `{origination_caller_id_number=${cid},origination_caller_id_name=${cid},` +
      `ignore_early_media=true,originate_timeout=${ORIGINATE_TIMEOUT}${recVar}}`;
    // Agent mode → route the answered leg into the served `ccx-<id>` dialplan so
    // it joins the queue AND gets a short apology if it's dropped without ever
    // reaching an agent (queue max-wait). Falls back to joining the queue directly
    // if the tenant slug (dialplan context) can't be resolved. Broadcast → audio.
    let app: string;
    if (queue) {
      const slug = await this.tenantSlug(campaign.tenantId);
      app = slug ? `ccx-${campaign.id} XML ${slug}` : `&callcenter(${queue})`;
    } else {
      app = `&playback(${(campaign.audioFile || '').trim() || DEFAULT_AUDIO})`;
    }
    const cmd = `originate ${vars}${destination} ${app}`;

    let body: string;
    try {
      body = await this.fs.api(cmd);
    } catch (err: any) {
      body = (err?.res?.body ?? err?.message ?? '').trim();
      if (!body) return { ok: false, cause: 'FAILED', recording: null };
    }
    if (body.startsWith('+OK')) return { ok: true, cause: 'ANSWERED', recording: recFile };
    return { ok: false, cause: body.replace(/^-ERR\s*/, '') || 'FAILED', recording: null };
  }

  /** Per-campaign aggregates for Reports › Campaign Report (from CallAttempt). */
  async campaignReport(tenantId: string) {
    const campaigns = await this.prisma.outboundCampaign.findMany({ where: { tenantId } });
    const out: any[] = [];
    for (const c of campaigns) {
      const attempts = await this.prisma.callAttempt.findMany({ where: { tenantId, campaignId: c.id } });
      const byNumber = new Set(attempts.map((a) => a.number));
      const answered = attempts.filter((a) => a.status === 'answered').length;
      const failed = attempts.filter((a) => a.status === 'failed').length;
      const skipped = attempts.filter((a) => a.status === 'skipped').length;
      const sale = attempts.filter((a) => /sale/i.test(a.disposition || '')).length;
      out.push({
        campaign: c.name,
        mode: /progressive|power|predict/i.test(c.dialMethod || '') ? 'agent' : 'broadcast',
        leadsDialed: byNumber.size,
        attempts: attempts.length,
        answered,
        failed,
        skippedDnc: skipped,
        sale,
      });
    }
    return out;
  }

  /** Live per-agent performance from mod_callcenter. */
  async agentPerformance(_tenantId: string) {
    let body = '';
    try { body = await this.fs.api('callcenter_config agent list'); } catch { return []; }
    const lines = body.split('\n').filter((l) => l && !l.startsWith('+OK'));
    if (!lines.length) return [];
    const header = lines[0].split('|');
    return lines.slice(1).map((line) => {
      const c = line.split('|');
      const r: Record<string, string> = {};
      header.forEach((h, i) => (r[h] = c[i] ?? ''));
      const answered = Number(r.calls_answered || 0);
      const talk = Number(r.talk_time || 0);
      return {
        agent: r.name, status: r.status, state: r.state,
        callsAnswered: answered, noAnswer: Number(r.no_answer_count || 0),
        talkTimeSec: talk, avgTalkSec: answered ? Math.round(talk / answered) : 0,
      };
    });
  }

  /** Recent call attempts (CDR-style) for Reports › CDRs. */
  async cdr(tenantId: string, limit = 500) {
    return this.prisma.callAttempt.findMany({
      where: { tenantId },
      orderBy: { startedAt: 'desc' },
      take: Math.min(limit, 2000),
    });
  }

  private async persist(run: Run, item: RunItem) {
    await this.prisma.callAttempt.create({
      data: {
        tenantId: run.tenantId,
        campaignId: run.campaignId,
        runId: run.runId,
        number: item.number,
        direction: 'outbound',
        status: item.status,
        cause: item.cause,
        disposition: item.disposition,
        attempt: item.attempts,
        agent: item.agent,
        recording: item.recording,
        endedAt: new Date(),
      },
    });
  }
}

function parseNumbers(numbers: string | string[]): string[] {
  const list = Array.isArray(numbers) ? numbers : typeof numbers === 'string' ? numbers.split(/[\s,;]+/) : [];
  return list.map((n) => String(n).replace(/[()\-.\s]/g, '')).filter((n) => /^\+?\d{2,15}$/.test(n));
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const digits = (n: string) => String(n ?? '').replace(/[^\d]/g, '');
const normalizePlus = (n: string) => String(n ?? '').trim();
const sanitizeCid = (cid: any) => (cid && /^[\w.+-]+$/.test(cid) ? cid : 'ucp');
function retryable(cause: string) {
  return /NO_ANSWER|USER_BUSY|NO_USER_RESPONSE|ALLOTTED_TIMEOUT|NORMAL_TEMPORARY|RECOVERY_ON_TIMER|not connected/i.test(cause || '');
}
function dispoFor(cause: string) {
  if (/NO_ANSWER|NO_USER_RESPONSE|ALLOTTED/i.test(cause)) return 'No Answer';
  if (/USER_BUSY/i.test(cause)) return 'Busy';
  if (/not connected/i.test(cause)) return 'System Error';
  return 'Failed';
}
function clampInt(v: any, min: number, max: number, dflt: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.round(n)));
}
function clampNum(v: any, min: number, max: number, dflt: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}
// Current wall-clock "HH:mm" in the given IANA timezone (falls back to server tz).
function nowHHmm(d: Date, tz?: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz }).format(d);
  } catch {
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  }
}
// Returns a human reason the campaign may NOT dial right now, or null if it may.
// Honours the active date range (scheduleStart/End) and the daily call window
// (callWindowStart/End in the campaign timezone; the window may wrap midnight).
export function scheduleBlockReason(campaign: any, now: Date = new Date()): string | null {
  if (campaign.scheduleStart && now < new Date(campaign.scheduleStart)) return 'the campaign has not started yet';
  if (campaign.scheduleEnd && now > new Date(campaign.scheduleEnd)) return 'the campaign schedule has ended';
  const ws = (campaign.callWindowStart || '').trim();
  const we = (campaign.callWindowEnd || '').trim();
  if (ws && we) {
    const tz = (campaign.timezone || '').trim() || undefined;
    const hhmm = nowHHmm(now, tz);
    const inWindow = ws <= we ? (hhmm >= ws && hhmm <= we) : (hhmm >= ws || hhmm <= we);
    if (!inWindow) return `outside the daily call window (${ws}–${we}${tz ? ' ' + tz : ''})`;
  }
  return null;
}
