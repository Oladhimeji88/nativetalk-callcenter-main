import { Body, Controller, Delete, Get, Module, NotFoundException, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { spawn } from 'child_process';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser, AllowAuthenticated } from '../common/decorators';
import { AuthUser } from '../common/rbac.guard';
import { teamScopeExtensions } from '../common/team-scope';
import { REC_DIR } from '../dialer/dialer.service';

// Recording files are immutable once written, so cache their measured length.
const recDurCache = new Map<string, number>();

/** True length of a recording (seconds), read with `soxi -D` on the media box.
 *  Null if it can't be measured. Used so the Recordings library shows the audio
 *  length, not the agent's talk time (which is 0 for a missed-but-recorded call). */
function recordingSeconds(file: string): Promise<number | null> {
  if (!file || !/^[\w.-]+\.wav$/.test(file)) return Promise.resolve(null);
  if (recDurCache.has(file)) return Promise.resolve(recDurCache.get(file)!);
  const host = process.env.FS_SSH_TARGET || process.env.FS_SSH_HOST || 'nativetalk-fs';
  const dir = process.env.FS_REMOTE_RECORDINGS_DIR || REC_DIR;
  return new Promise((resolve) => {
    let out = '';
    const child = spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', host, 'sudo', 'soxi', '-D', `${dir}/${file}`]);
    child.stdout.on('data', (d) => (out += d));
    child.on('error', () => resolve(null));
    child.on('close', () => {
      const s = Math.round(parseFloat(out.trim()));
      if (Number.isFinite(s) && s >= 0) { recDurCache.set(file, s); resolve(s); } else resolve(null);
    });
  });
}

type CreateCallLog = {
  direction?: string;
  agentExt?: string;
  peerNumber?: string;
  contactId?: string | null;
  campaignId?: string | null;
  disposition?: string;
  notes?: string;
  disconnectedBy?: string | null;
  status?: string;
  durationSec?: number;
  recording?: string;
  startedAt?: string;
  endedAt?: string;
};

// Call history. Written when a call ends (softphone/inbound/campaign) and read by
// the Call Logs page and the console's Recent Interactions / Last contact panels.
// Tenant-scoped; agents can read/write their own tenant's logs.
@AllowAuthenticated()
@Controller('call-logs')
export class CallLogsController {
  constructor(private prisma: PrismaService) {}

  /** Tenant-wide visibility needs the analytics permission; everyone else
   *  (agents) is scoped to calls they handled on their own extension. */
  private ownOnly(u: AuthUser): boolean {
    return !u.superAdmin && !u.permissions?.['analytics']?.enabled;
  }

  @Get()
  async list(
    @CurrentUser() u: AuthUser,
    @Query('peer') peer?: string,
    @Query('limit') limit?: string,
    @Query('exact') exact?: string,
    @Query('hasRecording') hasRecording?: string,
  ) {
    const take = Math.min(Number(limit) || 100, 500);
    let peerWhere = {};
    if (peer) {
      const digits = peer.replace(/\D/g, '');
      if (exact) {
        peerWhere = digits.length >= 10 ? { peerNumber: { endsWith: digits.slice(-9) } } : { peerNumber: peer };
      } else {
        peerWhere = { peerNumber: { contains: digits.slice(-7) || peer } };
      }
    }
    // Team-scoped managers only see calls handled by their team's agents.
    // Agents (no analytics permission) only see calls they handled themselves.
    const scopeExts = this.ownOnly(u) ? [u.agentExtension ?? ''] : await teamScopeExtensions(this.prisma, u);
    const logs = await this.prisma.callLog.findMany({
      where: {
        tenantId: u.tenantId,
        ...peerWhere,
        ...(hasRecording ? { recording: { not: null } } : {}),
        ...(scopeExts ? { agentExt: { in: scopeExts } } : {}),
      },
      orderBy: { startedAt: 'desc' },
      take,
    });
    const rows = hasRecording ? logs.filter((l) => l.recording) : logs;

    // Enrich with agent display name (from extension) + campaign name.
    const accounts = await this.prisma.account.findMany({ where: { tenantId: u.tenantId }, select: { agentExtension: true, firstName: true, lastName: true, email: true } });
    const byExt = new Map(accounts.filter((a) => a.agentExtension).map((a) => [a.agentExtension!, [a.firstName, a.lastName].filter(Boolean).join(' ') || a.email]));
    const campIds = [...new Set(rows.map((l) => l.campaignId).filter(Boolean))] as string[];
    const campaigns = campIds.length ? await this.prisma.outboundCampaign.findMany({ where: { tenantId: u.tenantId, id: { in: campIds } }, select: { id: true, name: true } }) : [];
    const campById = new Map(campaigns.map((c) => [c.id, c.name]));

    // Lead / contact details for the CDR: name + custom-field values. Prefer the
    // lead's snapshot (extra), fall back to the contact's current customFields.
    const defs = await this.prisma.customField.findMany({ where: { tenantId: u.tenantId }, orderBy: { order: 'asc' }, select: { key: true, label: true } });
    const leadIds = [...new Set(rows.map((l) => l.leadId).filter(Boolean))] as string[];
    const contactIds = [...new Set(rows.map((l) => l.contactId).filter(Boolean))] as string[];
    const leads = leadIds.length ? await this.prisma.lead.findMany({ where: { tenantId: u.tenantId, id: { in: leadIds } }, select: { id: true, name: true, extra: true } }) : [];
    const contacts = contactIds.length ? await this.prisma.contact.findMany({ where: { tenantId: u.tenantId, id: { in: contactIds } }, select: { id: true, name: true, customFields: true } }) : [];
    const leadById = new Map(leads.map((l) => [l.id, l]));
    const contactById = new Map(contacts.map((c) => [c.id, c]));
    const detailsFor = (l: (typeof rows)[number]) => {
      const lead = l.leadId ? leadById.get(l.leadId) : null;
      const contact = l.contactId ? contactById.get(l.contactId) : null;
      const values: Record<string, any> = (lead?.extra as any) || (contact?.customFields as any) || {};
      const fields = defs.map((d) => ({ label: d.label, value: values[d.key] })).filter((f) => f.value != null && f.value !== '');
      return { contactName: lead?.name || contact?.name || null, fields };
    };

    // For the Recordings library, measure the actual audio length (soxi) so the
    // Duration matches the recording rather than the agent's talk time.
    const recSecs = hasRecording
      ? new Map(await Promise.all(rows.filter((l) => l.recording).map(async (l) => [l.id, await recordingSeconds(l.recording!)] as const)))
      : new Map<string, number | null>();
    return rows.map((l) => ({
      ...l,
      agentName: l.agentExt ? byExt.get(l.agentExt) ?? null : null,
      campaignName: l.campaignId ? campById.get(l.campaignId) ?? null : null,
      recordingSec: recSecs.get(l.id) ?? null,
      ...detailsFor(l),
    }));
  }

  @Post()
  async create(@CurrentUser() u: AuthUser, @Body() b: CreateCallLog) {
    // Tag with the campaign so progressive/bridged calls show in campaign history
    // and disposition flows. Prefer what the client sent; otherwise infer from the
    // most recent dial attempt for this number (the dialer records every campaign
    // dial as a CallAttempt with the campaign) — robust even if the browser didn't
    // know the campaign.
    let campaignId = b.campaignId ?? null;
    const d9 = (b.peerNumber || '').replace(/\D/g, '').slice(-9);
    if (!campaignId && d9) {
      const att = await this.prisma.callAttempt.findFirst({
        where: {
          tenantId: u.tenantId, campaignId: { not: null },
          number: { endsWith: d9 }, startedAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
        },
        orderBy: { startedAt: 'desc' }, select: { campaignId: true },
      });
      campaignId = att?.campaignId ?? null;
    }
    return this.prisma.callLog.create({
      data: {
        tenantId: u.tenantId,
        direction: b.direction ?? 'outbound',
        agentExt: b.agentExt ?? u.agentExtension ?? null,
        peerNumber: b.peerNumber ?? '',
        contactId: b.contactId ?? null,
        campaignId,
        disposition: b.disposition ?? null,
        notes: b.notes ?? null,
        disconnectedBy: b.disconnectedBy ?? null,
        status: b.status ?? 'completed',
        durationSec: b.durationSec ?? 0,
        recording: b.recording ?? null,
        startedAt: b.startedAt ? new Date(b.startedAt) : new Date(),
        endedAt: b.endedAt ? new Date(b.endedAt) : new Date(),
      },
    });
  }

  // Stream a call's recording. The .wav lives on the FreeSWITCH box, so we fetch
  // it over SSH and pipe it back. (Dev/decoupled setup — prod would use shared
  // storage / an object store instead of SSH.)
  @Get(':id/recording')
  async recording(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query('download') download: string, @Res() res: Response) {
    const log = await this.prisma.callLog.findFirst({
      where: { id, tenantId: u.tenantId, ...(this.ownOnly(u) ? { agentExt: u.agentExtension ?? '' } : {}) },
    });
    const file = log?.recording ?? '';
    if (!file || !/^[\w.-]+\.wav$/.test(file)) throw new NotFoundException('no recording for this call');

    const host = process.env.FS_SSH_TARGET || process.env.FS_SSH_HOST || 'nativetalk-fs';
    // Read from where FreeSWITCH actually records (REC_DIR = FS_RECORDINGS_DIR),
    // overridable with FS_REMOTE_RECORDINGS_DIR.
    const dir = process.env.FS_REMOTE_RECORDINGS_DIR || REC_DIR;
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${file}"`);

    // recordings dir is owned by the freeswitch user (770); the SSH user reads it
    // via passwordless sudo.
    const child = spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', host, 'sudo', 'cat', `${dir}/${file}`]);
    child.stdout.pipe(res);
    child.on('error', () => { if (!res.headersSent) res.status(502); res.end(); });
    child.on('close', (code) => { if (code !== 0 && !res.writableEnded) res.end(); });
  }

  // Delete a call's recording: best-effort remove the file on the media box, then
  // clear the reference on the log.
  @Delete(':id/recording')
  async deleteRecording(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const log = await this.prisma.callLog.findFirst({
      where: { id, tenantId: u.tenantId, ...(this.ownOnly(u) ? { agentExt: u.agentExtension ?? '' } : {}) },
    });
    const file = log?.recording ?? '';
    if (file && /^[\w.-]+\.wav$/.test(file)) {
      const host = process.env.FS_SSH_HOST || 'nativetalk-fs';
      const dir = process.env.FS_REMOTE_RECORDINGS_DIR || '/var/lib/freeswitch/recordings';
      try { spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', host, 'sudo', 'rm', '-f', `${dir}/${file}`]); } catch { /* best effort */ }
    }
    if (!log) return { ok: false };
    await this.prisma.callLog.updateMany({ where: { id: log.id, tenantId: u.tenantId }, data: { recording: null } });
    return { ok: true };
  }

  @Patch(':id')
  async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: Partial<CreateCallLog>) {
    const data: Record<string, unknown> = {};
    for (const k of ['disposition', 'notes', 'status', 'recording', 'contactId'] as const) {
      if (b[k] !== undefined) data[k] = b[k];
    }
    const own = this.ownOnly(u) ? { agentExt: u.agentExtension ?? '' } : {};
    await this.prisma.callLog.updateMany({ where: { id, tenantId: u.tenantId, ...own }, data });
    return this.prisma.callLog.findFirst({ where: { id, tenantId: u.tenantId, ...own } });
  }
}

@Module({ controllers: [CallLogsController] })
export class CallLogsModule {}
