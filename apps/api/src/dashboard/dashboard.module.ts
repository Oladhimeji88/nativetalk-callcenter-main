import { Controller, Get, Injectable, Module, Query, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FreeswitchService } from '../freeswitch/freeswitch.service';
import { DialerModule } from '../dialer/dialer.module';
import { DialerService } from '../dialer/dialer.service';
import { CurrentUser, Permissions } from '../common/decorators';
import { RbacGuard, AuthUser } from '../common/rbac.guard';
import { teamScopeExtensions } from '../common/team-scope';

const digits = (n: string) => String(n ?? '').replace(/[^\d]/g, '');
const RANGES: Record<string, number> = { '1h': 3600e3, '24h': 86400e3, '7d': 604800e3, '30d': 2592000e3 };

// Aggregates a live Operations Dashboard snapshot: KPIs, live calls, agent
// status, and the two trend charts — from FreeSWITCH (live) + Postgres (history).
@Injectable()
export class DashboardService {
  constructor(
    private prisma: PrismaService,
    private fs: FreeswitchService,
    private dialer: DialerService,
  ) {}

  private parseTable(body: string) {
    const lines = (body || '').split('\n').filter((l) => l && !l.startsWith('+OK'));
    if (lines.length < 1) return [];
    const header = lines[0].split('|');
    return lines.slice(1).map((line) => {
      const cols = line.split('|');
      const row: Record<string, string> = {};
      header.forEach((h, i) => (row[h] = cols[i] ?? ''));
      return row;
    });
  }

  private extOf(agentName: string, contact: string): string {
    return (contact || '').replace(/^user\//, '').split('@')[0] || (agentName || '').split('@')[0];
  }

  async ops(user: AuthUser, range = '24h') {
    const tenantId = user.tenantId;
    // Team-scoped managers: metrics keyed off an agent extension are limited to
    // their team. Tenant/campaign/queue-level aggregates (contact rate, campaign
    // performance, calls waiting) aren't agent-attributable, so they stay global.
    const scopeExts = await teamScopeExtensions(this.prisma, user);
    const inTeam = (ext: string) => !scopeExts || (!!ext && scopeExts.includes(ext));
    const safe = async (cmd: string) => { try { return await this.fs.api(cmd); } catch { return ''; } };
    const [agentsRaw, callsRaw, channelsRaw, regsRaw] = await Promise.all([
      safe('callcenter_config agent list'),
      safe('show calls as json'),
      safe('show channels as json'),
      safe('show registrations'),
    ]);

    // ---- FreeSWITCH: live agent states (deduped by extension) ----
    const agentByExt = new Map<string, Record<string, string>>();
    for (const r of this.parseTable(agentsRaw)) {
      const ext = this.extOf(r.name, r.contact);
      if (ext && !agentByExt.has(ext)) agentByExt.set(ext, r);
    }

    // Who is actually ONLINE (SIP-registered). mod_callcenter agent status is
    // sticky — it stays "Available" after a softphone closes — so an agent is only
    // truly reachable if they're currently registered.
    const registered = new Set<string>();
    for (const line of (regsRaw || '').split('\n')) {
      const ext = line.split(',')[0].trim();
      if (/^\d{2,6}$/.test(ext)) registered.add(ext);
    }

    // ---- Accounts: names + the full roster (so we can show offline agents) ----
    const accounts = await this.prisma.account.findMany({
      where: { tenantId, agentExtension: { not: null }, ...(scopeExts ? { agentExtension: { in: scopeExts } } : {}) },
      select: { agentExtension: true, firstName: true, lastName: true, email: true },
    });
    const nameOf = (ext: string) => {
      const a = accounts.find((x) => x.agentExtension === ext);
      return a ? [a.firstName, a.lastName].filter(Boolean).join(' ') || a.email : ext;
    };

    const statusOf = (row?: Record<string, string>): string => {
      if (!row) return 'offline';
      const s = row.status || '', st = row.state || '';
      if (/Logged Out/i.test(s)) return 'offline';
      if (/Break/i.test(s)) return 'away';
      if (/wrap/i.test(st)) return 'wrap-up';
      if (/Active|Receiving|In a queue/i.test(st)) return 'on-call';
      if (/Available/i.test(s) && /Waiting/i.test(st)) return 'available';
      return 'available';
    };

    const agents = accounts.map((a) => {
      const ext = a.agentExtension!;
      // Not registered → offline, whatever mod_callcenter's sticky status says.
      const status = registered.has(ext) ? statusOf(agentByExt.get(ext)) : 'offline';
      return { name: nameOf(ext), ext, status };
    }).sort((x, y) => x.ext.localeCompare(y.ext));

    const agentsAvailable = agents.filter((a) => a.status === 'available').length;
    const agentsTotal = agents.length;

    // ---- Live calls: bridged pairs from FS + in-flight dialer items ----
    let fsCalls: any[] = [];
    try { fsCalls = JSON.parse(callsRaw).rows ?? []; } catch { /* none */ }
    let channels: any[] = [];
    try { channels = JSON.parse(channelsRaw).rows ?? []; } catch { /* none */ }
    const ctx = this.dialer.liveDialingContext(tenantId); // number(digits) -> {campaign, queue}
    const now = Date.now() / 1000;

    const liveCalls: any[] = [];
    const seen = new Set<string>();
    // Bridged/active calls from `show calls` (has both legs).
    for (const c of fsCalls) {
      const caller = c.cid_num || c.b_cid_num || c.dest || '';
      const agentExt = this.extOf(c.callee_num || c.b_cid_num || '', c.b_name || c.name || '');
      if (scopeExts && !inTeam(agentExt)) continue; // scoped: only this team's calls
      const created = Number(c.created_epoch || 0);
      const key = c.call_uuid || c.uuid || caller;
      if (seen.has(key)) continue; seen.add(key);
      const cx = ctx[digits(caller)];
      liveCalls.push({
        caller, agent: agentExt ? nameOf(agentExt) : null,
        campaign: cx?.campaign ?? null, queue: cx?.queue ? String(cx.queue).replace(/@.*/, '') : null,
        durationSec: created ? Math.max(0, Math.round(now - created)) : 0,
        status: /HELD/i.test(c.callstate || c.b_callstate || '') ? 'on-hold' : 'connected',
      });
    }
    // Ringing / dialing calls the dialer has in flight but not yet bridged.
    // These aren't attributable to an agent yet, so a scoped manager doesn't see them.
    for (const [num, cx] of (scopeExts ? [] : Object.entries(ctx))) {
      if (liveCalls.some((l) => digits(l.caller) === num)) continue;
      const ch = channels.find((c: any) => digits(c.cid_num || c.dest || '') === num);
      const created = Number(ch?.created_epoch || 0);
      liveCalls.push({
        caller: ch?.cid_num || ch?.dest || num, agent: null,
        campaign: cx.campaign, queue: cx.queue ? String(cx.queue).replace(/@.*/, '') : null,
        durationSec: created ? Math.max(0, Math.round(now - created)) : 0,
        status: 'ringing',
      });
    }

    // Calls Waiting = real customers holding in an ACD queue for an agent.
    let callsWaiting = 0;
    for (const q of this.dialer.activeQueues(tenantId)) {
      const body = await safe(`callcenter_config queue list members ${q}`);
      callsWaiting += body.split('\n').filter((l) => l.includes('|') && /\b(Waiting|Trying)\b/i.test(l)).length;
    }

    // ---- History (Postgres): windowed calls / contact rate / handle time, with
    // deltas vs the previous equal-length window. ----
    const winMs = RANGES[range] ?? RANGES['24h'];
    const nowT = Date.now();
    const windowMetrics = async (from: Date, to: Date) => {
      const scopeWhere = scopeExts ? { agentExt: { in: scopeExts } } : {};
      const [calls, handle, att] = await Promise.all([
        this.prisma.callLog.count({ where: { tenantId, ...scopeWhere, startedAt: { gte: from, lt: to } } }),
        this.prisma.callLog.aggregate({ where: { tenantId, ...scopeWhere, status: 'completed', durationSec: { gt: 0 }, startedAt: { gte: from, lt: to } }, _avg: { durationSec: true } }),
        this.prisma.callAttempt.groupBy({ by: ['status'], where: { tenantId, startedAt: { gte: from, lt: to } }, _count: true }),
      ]);
      const total = att.reduce((s, r) => s + r._count, 0);
      const ok = att.filter((r) => /answered|completed/i.test(r.status)).reduce((s, r) => s + r._count, 0);
      return { calls, avgHandle: Math.round(handle._avg.durationSec || 0), contactRate: total ? Math.round((ok / total) * 1000) / 10 : 0, total };
    };
    const cur = await windowMetrics(new Date(nowT - winMs), new Date(nowT));
    const prev = await windowMetrics(new Date(nowT - 2 * winMs), new Date(nowT - winMs));
    const pctChange = (c: number, p: number) => (p > 0 ? Math.round(((c - p) / p) * 1000) / 10 : null);

    // ---- Charts: 14-day contact-rate trend + per-campaign contact rate ----
    const since = new Date(); since.setDate(since.getDate() - 13); since.setHours(0, 0, 0, 0);
    const recent = await this.prisma.callAttempt.findMany({
      where: { tenantId, startedAt: { gte: since } },
      select: { status: true, startedAt: true },
    });
    const byDay = new Map<string, { total: number; ok: number }>();
    for (let i = 0; i < 14; i++) {
      const d = new Date(since); d.setDate(since.getDate() + i);
      byDay.set(d.toISOString().slice(0, 10), { total: 0, ok: 0 });
    }
    for (const a of recent) {
      const k = a.startedAt.toISOString().slice(0, 10);
      const b = byDay.get(k); if (!b) continue;
      b.total++; if (/answered|completed/i.test(a.status)) b.ok++;
    }
    const contactRateSeries = [...byDay.entries()].map(([day, v]) => ({
      label: day.slice(5), rate: v.total ? Math.round((v.ok / v.total) * 1000) / 10 : 0,
    }));

    const campaigns = await this.prisma.outboundCampaign.findMany({ where: { tenantId }, select: { id: true, name: true } });
    const perfRaw = await this.prisma.callAttempt.groupBy({
      by: ['campaignId', 'status'], where: { tenantId, campaignId: { not: null } }, _count: true,
    });
    const campaignPerformance = campaigns.map((c) => {
      const rows = perfRaw.filter((r) => r.campaignId === c.id);
      const total = rows.reduce((s, r) => s + r._count, 0);
      const ok = rows.filter((r) => /answered|completed/i.test(r.status)).reduce((s, r) => s + r._count, 0);
      return { name: c.name, rate: total ? Math.round((ok / total) * 1000) / 10 : 0 };
    }).filter((c) => c.rate > 0 || campaigns.length <= 6).slice(0, 8);

    return {
      at: new Date().toISOString(),
      range,
      kpis: {
        // Real-time (now). Scoped managers see only their team's active calls.
        activeCalls: scopeExts ? liveCalls.filter((l) => l.status !== 'ringing').length : fsCalls.length,
        agentsAvailable, agentsTotal,
        callsWaiting,
        // Windowed (respect the range) + deltas vs the previous equal window
        calls: cur.calls, callsDelta: pctChange(cur.calls, prev.calls),
        contactRate: cur.contactRate, contactRateDelta: prev.total > 0 ? Math.round((cur.contactRate - prev.contactRate) * 10) / 10 : null,
        avgHandleSec: cur.avgHandle, avgHandleDelta: prev.avgHandle > 0 ? cur.avgHandle - prev.avgHandle : null,
      },
      liveCalls: liveCalls.slice(0, 50),
      agents,
      contactRateSeries,
      campaignPerformance,
    };
  }
}

@Controller('dashboard')
@UseGuards(RbacGuard)
@Permissions('analytics')
export class DashboardController {
  constructor(private svc: DashboardService) {}

  @Get('ops')
  ops(@CurrentUser() u: AuthUser, @Query('range') range?: string) {
    return this.svc.ops(u, range || '24h');
  }
}

@Module({
  imports: [DialerModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
