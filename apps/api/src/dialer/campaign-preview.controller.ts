import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser, Permissions } from '../common/decorators';
import { AuthUser } from '../common/rbac.guard';
import { DialerService } from './dialer.service';

// Default-disposition categories (used when a disposition isn't a configured row).
const DEFAULT_CATEGORY: Record<string, string> = {
  'Answered — Spoke': 'success',
  'No Answer': 'retry',
  'Busy': 'retry',
  'Wrong Number': 'failure',
  'Callback Requested': 'callback',
  'Do Not Call': 'dnc',
};

// How long a reserved-but-untouched preview lead may sit before it's offered
// again. Longer than any realistic call + wrap-up, so an active agent keeps it.
const RESERVATION_STALE_MS = 10 * 60 * 1000; // 10 minutes

function parseNumbers(raw?: string): string[] {
  if (!raw) return [];
  return Array.from(new Set(
    raw.split(/[\s,;\n]+/).map((s) => s.trim()).filter((s) => /\d{3,}/.test(s)),
  ));
}

// Agent-facing PREVIEW dialing: the agent works a campaign one lead at a time —
// the system hands them the next lead (reserving it so two agents don't get the
// same one), the agent dials it from the Call Console, then dispositions it and
// gets the next. This is the manual-paced sibling of the progressive dialer;
// both share this lead lifecycle + CallLog logging.
@Permissions('softphone')
@Controller('campaigns')
export class CampaignPreviewController {
  constructor(private prisma: PrismaService, private dialer: DialerService) {}

  // Preview campaigns the current user is assigned to work (for the Console
  // picker). Only Preview is agent-paced from the Console; progressive/power
  // campaigns are joined via Play (see /joinable + /join).
  @Get('mine')
  mine(@CurrentUser() u: AuthUser) {
    return this.prisma.outboundCampaign.findMany({
      where: { tenantId: u.tenantId, active: true, assignedAgentIds: { has: u.id }, dialMethod: 'Preview' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, dialMethod: true, directionType: true },
    });
  }

  // Active agent-dialed campaigns this agent may play into (progressive/power/
  // predictive). Playing in attaches them to the campaign queue to receive calls.
  @Get('joinable')
  joinable(@CurrentUser() u: AuthUser) {
    return this.prisma.outboundCampaign.findMany({
      where: { tenantId: u.tenantId, active: true, assignedAgentIds: { has: u.id }, dialMethod: { in: ['Progressive', 'Power', 'Predictive'] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, dialMethod: true, directionType: true },
    });
  }

  // Agent "Play": join this campaign's queue (become available for it), starting
  // the dialer if it isn't already running.
  @Post(':id/join')
  async join(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const run = await this.dialer.agentJoin(u.tenantId, id, u.id, u.agentExtension ?? null);
    return { ok: true, campaignId: id, joined: run.joinedAgents };
  }

  // Agent "Break": leave this campaign's queue.
  @Post(':id/leave')
  leave(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.dialer.agentLeave(u.tenantId, id, u.agentExtension ?? null);
  }

  // The campaign this agent is currently played into (for restoring state after a
  // page refresh). null when they're not playing into anything.
  @Get('joined')
  joined(@CurrentUser() u: AuthUser) {
    return { campaignId: this.dialer.activeCampaignForAgent(u.tenantId, u.agentExtension ?? null) };
  }

  // Disposition a progressive/auto-dialed call the agent was bridged to. Unlike
  // Preview (which the agent paces), the call arrived via the ACD queue, so we key
  // the disposition to the campaign lead by the customer's number. This writes the
  // lead's status/lastDisposition so a re-run can exclude it.
  @Post(':id/call-disposition')
  callDisposition(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() b: { number?: string; disposition?: string; notes?: string },
  ) {
    return this.dialer.dispositionCall(u.tenantId, id, b?.number ?? '', b?.disposition ?? '', b?.notes);
  }

  // Poll whether the agent is still playing in (run may have finished / been
  // stopped), so the Console can take them off automatically.
  @Get(':id/participation')
  participation(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.dialer.agentParticipation(id, u.agentExtension ?? null);
  }

  // Reserve and return the next workable lead for this campaign.
  @Get(':id/preview/next')
  async next(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const campaign = await this.prisma.outboundCampaign.findFirst({ where: { id, tenantId: u.tenantId } });
    if (!campaign) throw new NotFoundException('campaign not found');
    await this.ensureLeads(u.tenantId, campaign);
    await this.reclaimStale(u.tenantId, id);

    // Slim campaign payload the Console needs (returned on every branch so the
    // UI can switch into preview mode even when the campaign has no leads yet).
    const campaignInfo = {
      id: campaign.id,
      name: campaign.name,
      callerId: campaign.callerId,
      successDisposition: campaign.successDisposition,
      recording: campaign.recording,
      dispositionIds: campaign.dispositionIds ?? [],
    };

    // Fresh leads first (oldest first); once those run out, resurface leads the
    // agent skipped earlier (oldest skip first) — so a Skip sends the lead to the
    // back of the queue rather than retiring it.
    let lead = await this.prisma.lead.findFirst({
      where: { tenantId: u.tenantId, campaignId: id, status: 'new' },
      orderBy: { createdAt: 'asc' },
    });
    if (!lead) {
      lead = await this.prisma.lead.findFirst({
        where: { tenantId: u.tenantId, campaignId: id, status: 'skipped' },
        orderBy: { updatedAt: 'asc' },
      });
    }
    if (!lead) {
      const total = await this.prisma.lead.count({ where: { tenantId: u.tenantId, campaignId: id } });
      return { done: true, lead: null, remaining: 0, total, campaign: campaignInfo };
    }

    // Reserve it (so a second agent working the same campaign skips it).
    await this.prisma.lead.update({ where: { id: lead.id }, data: { status: 'dialing', attempts: { increment: 1 } } });
    const contact = await this.findContact(u.tenantId, lead.phone);
    const remaining = await this.prisma.lead.count({ where: { tenantId: u.tenantId, campaignId: id, status: { in: ['new', 'skipped'] } } });

    return {
      done: false,
      remaining,
      campaign: campaignInfo,
      lead: { id: lead.id, name: lead.name, phone: lead.phone, attempts: lead.attempts + 1 },
      contact,
    };
  }

  // Log a preview call the moment it ends (before the agent dispositions), so
  // every attempt shows up in history. The disposition then updates this record.
  @Post(':id/preview/log')
  async logAttempt(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() b: { leadId?: string; durationSec?: number; peerNumber?: string; status?: string; contactId?: string; startedAt?: string; recording?: string; disconnectedBy?: string | null },
  ) {
    const campaign = await this.prisma.outboundCampaign.findFirst({ where: { id, tenantId: u.tenantId } });
    if (!campaign) throw new NotFoundException('campaign not found');
    const lead = b.leadId ? await this.prisma.lead.findFirst({ where: { id: b.leadId, tenantId: u.tenantId } }) : null;
    return this.prisma.callLog.create({
      data: {
        tenantId: u.tenantId,
        direction: 'outbound',
        agentExt: u.agentExtension ?? null,
        peerNumber: b.peerNumber ?? lead?.phone ?? '',
        contactId: b.contactId ?? null,
        campaignId: id,
        leadId: b.leadId ?? null,
        disconnectedBy: b.disconnectedBy ?? null,
        status: b.status ?? 'completed',
        durationSec: b.durationSec ?? 0,
        recording: b.recording ?? null,
        startedAt: b.startedAt ? new Date(b.startedAt) : new Date(),
        endedAt: new Date(),
      },
    });
  }

  // Record a preview call's outcome: update the attempt already logged on hangup
  // (or create one if none), and advance the lead based on the disposition.
  @Post(':id/preview/disposition')
  async dispose(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() b: { logId?: string; leadId?: string; disposition?: string; notes?: string; durationSec?: number; peerNumber?: string; status?: string; contactId?: string; startedAt?: string; recording?: string },
  ) {
    const campaign = await this.prisma.outboundCampaign.findFirst({ where: { id, tenantId: u.tenantId } });
    if (!campaign) throw new NotFoundException('campaign not found');
    const lead = b.leadId ? await this.prisma.lead.findFirst({ where: { id: b.leadId, tenantId: u.tenantId } }) : null;

    let logId = b.logId ?? null;
    if (logId) {
      // Annotate the attempt already logged on hangup (tenant-scoped).
      const r = await this.prisma.callLog.updateMany({
        where: { id: logId, tenantId: u.tenantId },
        data: {
          disposition: b.disposition ?? null,
          notes: b.notes ?? null,
          ...(b.recording ? { recording: b.recording } : {}),
          ...(typeof b.durationSec === 'number' ? { durationSec: b.durationSec } : {}),
          ...(b.status ? { status: b.status } : {}),
        },
      });
      if (r.count === 0) logId = null; // stale id; fall through to create
    }
    if (!logId) {
      const log = await this.prisma.callLog.create({
        data: {
          tenantId: u.tenantId,
          direction: 'outbound',
          agentExt: u.agentExtension ?? null,
          peerNumber: b.peerNumber ?? lead?.phone ?? '',
          contactId: b.contactId ?? null,
          campaignId: id,
          leadId: b.leadId ?? null,
          disposition: b.disposition ?? null,
          notes: b.notes ?? null,
          status: b.status ?? 'completed',
          durationSec: b.durationSec ?? 0,
          recording: b.recording ?? null,
          startedAt: b.startedAt ? new Date(b.startedAt) : new Date(),
          endedAt: new Date(),
        },
      });
      logId = log.id;
    }

    if (lead) {
      const outcome = await this.leadOutcome(u.tenantId, b.disposition, b.status);
      const retryable = outcome === 'retry' && lead.attempts < Math.max(1, campaign.maxAttempts);
      await this.prisma.lead.update({
        where: { id: lead.id },
        data: {
          status: outcome === 'dnc' ? 'dnc' : retryable ? 'new' : 'done',
          lastDisposition: b.disposition ?? lead.lastDisposition,
        },
      });
    }
    return { ok: true, logId };
  }

  // Put a reserved lead back (agent skipped it without calling).
  // Skip sends the lead to the BACK of the queue ('skipped'), so it resurfaces
  // after the remaining fresh leads instead of being retired. To stop a lead for
  // good the agent dispositions it (e.g. Wrong Number / Do Not Call).
  @Post(':id/preview/skip')
  async skip(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: { leadId?: string }) {
    if (b.leadId) {
      await this.prisma.lead.updateMany({
        where: { id: b.leadId, tenantId: u.tenantId, status: 'dialing' },
        data: { status: 'skipped', lastDisposition: 'Skipped' },
      });
    }
    return { ok: true };
  }

  // A preview lead is reserved ('dialing') the moment it's handed to an agent.
  // If that agent never dispositions or skips it (they refreshed, navigated
  // away, or closed the tab), the lead would be stranded forever. Reclaim any
  // reservation that has gone quiet for longer than the stale window so the
  // lead is offered again. The window is long enough not to steal a lead a
  // second agent is actively working or has a live call on.
  private async reclaimStale(tenantId: string, campaignId: string) {
    const staleBefore = new Date(Date.now() - RESERVATION_STALE_MS);
    await this.prisma.lead.updateMany({
      where: { tenantId, campaignId, status: 'dialing', updatedAt: { lt: staleBefore } },
      data: { status: 'new', attempts: { decrement: 1 } },
    });
  }

  // Materialise the campaign's pasted numbers + lead-group members into
  // campaign-scoped leads the first time it's worked.
  private async ensureLeads(tenantId: string, campaign: any) {
    const existing = await this.prisma.lead.count({ where: { tenantId, campaignId: campaign.id } });
    if (existing > 0) return;
    const rows: { tenantId: string; campaignId: string; phone: string; name?: string | null; status: string }[] = [];
    for (const phone of parseNumbers(campaign.numbers)) rows.push({ tenantId, campaignId: campaign.id, phone, status: 'new' });
    if (campaign.leadGroupId) {
      const group = await this.prisma.lead.findMany({ where: { tenantId, leadGroupId: campaign.leadGroupId } });
      for (const l of group) rows.push({ tenantId, campaignId: campaign.id, phone: l.phone, name: l.name, status: 'new' });
    }
    if (campaign.contactGroupId) {
      // '*' = all of the tenant's contacts; otherwise just the chosen group.
      const where = campaign.contactGroupId === '*'
        ? { tenantId }
        : { tenantId, groupIds: { has: campaign.contactGroupId } };
      const contacts = await this.prisma.contact.findMany({ where });
      for (const c of contacts) if (c.phone) rows.push({ tenantId, campaignId: campaign.id, phone: c.phone, name: c.name, status: 'new' });
    }
    // de-dupe by phone
    const seen = new Set<string>();
    const dedup = rows.filter((r) => (seen.has(r.phone) ? false : (seen.add(r.phone), true)));
    if (dedup.length) await this.prisma.lead.createMany({ data: dedup });
  }

  private async findContact(tenantId: string, phone: string) {
    const digits = (phone || '').replace(/\D/g, '');
    const where = digits.length >= 10
      ? { tenantId, phone: { endsWith: digits.slice(-9) } }
      : { tenantId, phone };
    const rows = await this.prisma.contact.findMany({ where, orderBy: { updatedAt: 'desc' }, take: 1 });
    return rows[0] ?? null;
  }

  private async leadOutcome(tenantId: string, disposition?: string, status?: string): Promise<'retry' | 'dnc' | 'done'> {
    if (status && status !== 'completed') return 'retry'; // never connected → retry
    if (!disposition) return 'done';
    const row = await this.prisma.disposition.findFirst({ where: { tenantId, name: disposition } });
    const cat = (row?.category || DEFAULT_CATEGORY[disposition] || '').toLowerCase();
    if (cat === 'dnc') return 'dnc';
    if (cat === 'retry') return 'retry';
    return 'done';
  }
}
