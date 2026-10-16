import {
  Body, Controller, Delete, Get, Param, Patch, Post, UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser, Permissions } from '../common/decorators';
import { RbacGuard, AuthUser } from '../common/rbac.guard';
import { PbxService } from './pbx.service';
import { FreeswitchService } from '../freeswitch/freeswitch.service';

// mod_callcenter strategies we expose. The UI shows friendly labels; the stored
// value is the raw FreeSWITCH strategy so fs-xml can emit it verbatim.
const STRATEGIES = ['ring-all', 'round-robin', 'longest-idle-agent', 'top-down'];

type QueueRow = {
  id: string; number: string; strategy: string; moh: string;
  members: unknown; maxWaitSec: number; slaTargetPct: number; active: boolean;
};

/**
 * Call Queues (inbound ACD). A dedicated controller — not the generic pbx CRUD —
 * because queues are managed by supervisors (permission `queues`, not `pbx`),
 * auto-assign a dialable number on create, and decorate the list with live
 * mod_callcenter stats (callers waiting, average wait, health) read over ESL.
 */
@Controller('pbx/queues')
@UseGuards(RbacGuard)
@Permissions('queues')
export class QueuesController {
  constructor(
    public prisma: PrismaService,
    public pbx: PbxService,
    private fs: FreeswitchService,
  ) {}

  @Get() async list(@CurrentUser() u: AuthUser) {
    const rows = await this.prisma.queue.findMany({
      where: { tenantId: u.tenantId }, orderBy: { createdAt: 'asc' },
    });
    const stats = await this.liveStats(rows as unknown as QueueRow[]);
    return rows.map((q) => {
      const members = Array.isArray(q.members) ? (q.members as unknown[]) : [];
      const live = stats[q.id] ?? { waiting: 0, avgWaitSec: 0, health: members.length ? 'Healthy' : 'Idle' };
      return { ...q, membersCount: members.length, ...live };
    });
  }

  @Post() async create(@CurrentUser() u: AuthUser, @Body() b: any) {
    const data = this.clean(b);
    if (!data.number) data.number = await this.nextNumber(u.tenantId);
    const r = await this.prisma.queue.create({ data: { ...data, tenantId: u.tenantId } });
    await this.pbx.safeSync(u.tenantId);
    return r;
  }

  @Patch(':id') async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) {
    const r = await this.prisma.queue.updateMany({ where: { id, tenantId: u.tenantId }, data: this.clean(b, true) });
    await this.pbx.safeSync(u.tenantId);
    return r;
  }

  @Delete(':id') async remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const r = await this.prisma.queue.deleteMany({ where: { id, tenantId: u.tenantId } });
    await this.pbx.safeSync(u.tenantId);
    return r;
  }

  // Whitelist client input. `number` is the queue's dialplan identity, so it's
  // settable only on create; everything else is bounded/validated.
  private clean(b: any, isUpdate = false) {
    const out: any = {};
    if (typeof b?.name === 'string') out.name = b.name.trim().slice(0, 60);
    if (typeof b?.strategy === 'string' && STRATEGIES.includes(b.strategy)) out.strategy = b.strategy;
    if (b?.slaTargetPct != null) out.slaTargetPct = Math.max(0, Math.min(100, Math.round(Number(b.slaTargetPct)) || 0));
    if (b?.maxWaitSec != null) out.maxWaitSec = Math.max(0, Math.round(Number(b.maxWaitSec)) || 0);
    if (typeof b?.moh === 'string') out.moh = b.moh;
    if (Array.isArray(b?.members)) {
      out.members = [...new Set(b.members.map((m: any) => String(m).replace(/\D/g, '')).filter(Boolean))];
    }
    if (typeof b?.active === 'boolean') out.active = b.active;
    if (!isUpdate && b?.number) out.number = String(b.number).replace(/\D/g, '').slice(0, 10);
    return out;
  }

  // First free number in 3000-3999, checked against every dialable resource so a
  // queue can't shadow an extension / ring group / IVR / DID / time condition.
  private async nextNumber(tenantId: string): Promise<string> {
    const [queues, exts, rgs, ivrs, ins, tcs] = await Promise.all([
      this.prisma.queue.findMany({ where: { tenantId }, select: { number: true } }),
      this.prisma.extension.findMany({ where: { tenantId }, select: { extension: true } }),
      this.prisma.ringGroup.findMany({ where: { tenantId }, select: { number: true } }),
      this.prisma.ivr.findMany({ where: { tenantId }, select: { number: true } }),
      this.prisma.inboundRoute.findMany({ where: { tenantId }, select: { did: true } }),
      this.prisma.timeCondition.findMany({ where: { tenantId }, select: { number: true } }),
    ]);
    const used = new Set<string>([
      ...queues.map((x) => x.number),
      ...exts.map((x) => x.extension),
      ...rgs.map((x) => x.number),
      ...ivrs.map((x) => x.number),
      ...ins.map((x) => x.did),
      ...tcs.map((x) => x.number),
    ].map((v) => String(v)));
    for (let n = 3000; n <= 3999; n++) if (!used.has(String(n))) return String(n);
    throw new Error('No free queue number available (3000-3999 exhausted)');
  }

  // Per-queue live snapshot from mod_callcenter. Our queues live in the shared
  // `default` callcenter namespace, keyed by queue id (q-<id>@default) so tenants
  // can't collide on the box-wide config. Degrades to nothing if FS is down.
  private async liveStats(rows: QueueRow[]): Promise<Record<string, { waiting: number; avgWaitSec: number; health: string }>> {
    const out: Record<string, { waiting: number; avgWaitSec: number; health: string }> = {};
    if (!this.fs.isConnected()) return out;
    const now = Math.floor(Date.now() / 1000);
    for (const q of rows) {
      try {
        const body = await this.fs.api(`callcenter_config queue list members q-${q.id}@default`);
        const waiters = body.split('\n').filter((l) => l.includes('|') && /\|(Waiting|Trying)\b/i.test(l));
        const waits = waiters.map((l) => {
          const joined = Number(l.split('|')[5] || 0); // joined_epoch column
          return joined ? Math.max(0, now - joined) : 0;
        });
        const waiting = waiters.length;
        const avgWaitSec = waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : 0;
        const memberCount = Array.isArray(q.members) ? (q.members as unknown[]).length : 0;
        const health = waiting > memberCount ? 'Overloaded' : waiting > 0 ? 'Busy' : memberCount ? 'Healthy' : 'Idle';
        out[q.id] = { waiting, avgWaitSec, health };
      } catch { /* queue not loaded yet → caller falls back to defaults */ }
    }
    return out;
  }
}
