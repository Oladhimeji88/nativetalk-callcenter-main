import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { FreeswitchService } from '../freeswitch/freeswitch.service';
import { AuthUser } from '../common/rbac.guard';
import { teamScopeIds } from '../common/team-scope';

// Valid mod_callcenter agent states the agent workspace exposes.
export const AGENT_STATUSES = ['Available', 'Available (On Demand)', 'On Break', 'Logged Out'] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

const MONITOR_MODES: Record<string, (uuid: string) => string> = {
  listen: (uuid) => uuid,
  whisper: (uuid) => `${uuid} eavesdrop_whisper_aleg=true`,
  barge: (uuid) => `${uuid} eavesdrop_bridge_aleg=true eavesdrop_bridge_bleg=true`,
};

@Injectable()
export class TelephonyService {
  constructor(
    private prisma: PrismaService,
    private fs: FreeswitchService,
    private config: ConfigService,
  ) {}

  // The SIP domain the softphone registers under. This MUST be deterministic and
  // MUST match the domain FreeSWITCH serves its directory under (the FS box's
  // global `domain`, e.g. its public IP). A configured value takes priority so a
  // momentary ESL blip can't poison it to 127.0.0.1 — which registers the
  // softphone under the wrong domain and silently breaks call routing. ESL is
  // only a fallback for when FS_SIP_DOMAIN isn't set.
  private async domain(): Promise<string> {
    const configured = this.config.get<string>('FS_SIP_DOMAIN');
    if (configured?.trim()) return configured.trim();
    try {
      const d = (await this.fs.api('global_getvar domain')).trim();
      if (d && d !== '127.0.0.1') return d;
    } catch { /* ignore */ }
    return '127.0.0.1';
  }

  /**
   * Everything a browser softphone needs to register the given extension.
   * Returns the SIP secret, so it's tenant-scoped and auth-protected.
   */
  async softphoneConfig(user: AuthUser, extension: string) {
    const ext = await this.prisma.extension.findFirst({ where: { tenantId: user.tenantId, extension } });
    if (!ext) throw new NotFoundException(`extension ${extension} not found`);
    const domain = await this.domain();
    const wsUrl = this.config.get<string>('FS_WS_URL') ?? `ws://${domain}:5066`;
    const stun = this.config.get<string>('FS_STUN_URL') ?? 'stun:stun.l.google.com:19302';
    return {
      extension: ext.extension,
      password: ext.password,
      displayName: ext.displayName ?? `Extension ${ext.extension}`,
      sipDomain: domain,
      uri: `sip:${ext.extension}@${domain}`,
      wsServer: wsUrl,
      iceServers: stun ? [{ urls: stun }] : [],
    };
  }

  /**
   * Start recording the agent's live call. The softphone call lives on
   * FreeSWITCH, so we find the agent's active channel over ESL and issue
   * `uuid_record`. FreeSWITCH writes to its own recordings dir; we return just
   * the filename to store on the CallLog. Recording auto-stops at hangup.
   */
  async startRecording(extension: string): Promise<{ recording: string }> {
    if (!/^\d{2,8}$/.test(extension || '')) throw new BadRequestException('valid extension required');

    let dir = '';
    try { dir = (await this.fs.api('global_getvar recordings_dir')).trim(); } catch { /* ignore */ }
    if (!dir || dir.startsWith('-ERR') || dir === '_undef_') dir = '/var/lib/freeswitch/recordings';

    // Find the agent's active channel.
    let uuid = '';
    try {
      const body = await this.fs.api('show channels as json');
      const rows = JSON.parse(body).rows ?? [];
      const ch = rows.find((r: any) => r.cid_num === extension || String(r.name || '').includes(`/${extension}@`));
      uuid = ch?.uuid || '';
    } catch { /* ignore */ }
    if (!uuid) throw new NotFoundException('no active call for this extension');

    const file = `preview_${extension}_${Date.now()}.wav`;
    const path = `${dir}/${file}`.replace(/\\/g, '/');
    const res = await this.fs.api(`uuid_record ${uuid} start ${path}`);
    if (!String(res).startsWith('+OK')) throw new BadRequestException(`record failed: ${String(res).slice(0, 120)}`);
    return { recording: file };
  }

  /** Live channels (for supervisor view). */
  async liveCalls() {
    try {
      const body = await this.fs.api('show calls as json');
      return JSON.parse(body).rows ?? [];
    } catch {
      return [];
    }
  }

  /** Supervisor monitoring: ring `agent` and eavesdrop on `uuid`. */
  async monitor(uuid: string, mode: string, agent: string) {
    if (!/^[\w-]+$/.test(uuid)) throw new NotFoundException('invalid call uuid');
    if (!/^\d{2,8}$/.test(agent)) throw new NotFoundException('agent must be a numeric extension');
    const build = MONITOR_MODES[mode];
    if (!build) throw new NotFoundException(`mode must be one of ${Object.keys(MONITOR_MODES).join(', ')}`);
    const vars = `{park_after_bridge=true}`;
    const jobUuid = await this.fs.bgapi(`originate ${vars}user/${agent} &eavesdrop(${build(uuid)})`);
    return { ok: true, mode, agent, target: uuid, jobUuid };
  }

  /** The uuid of an extension's live channel (the agent's own leg), or ''. */
  private findChannelUuid(rows: any[], ext: string): string {
    const ch = rows.find((r) => r?.cid_num === ext || String(r?.name || '').includes(`/${ext}@`));
    return ch?.uuid || '';
  }

  /**
   * Supervisor monitoring by agent extension. Resolves the target agent's live
   * channel and rings the supervisor's own softphone into it. We eavesdrop the
   * AGENT's leg, so `whisper` talks to the agent only (coach) and `barge` bridges
   * both parties. The supervisor's phone rings; when they answer they're in.
   */
  async monitorAgent(targetExt: string, mode: string, user: AuthUser) {
    const supervisorExt = user.agentExtension ?? '';
    if (!/^\d{2,8}$/.test(targetExt)) throw new BadRequestException('valid agent extension required');
    if (!/^\d{2,8}$/.test(supervisorExt)) throw new BadRequestException('your softphone extension is not set');
    if (targetExt === supervisorExt) throw new BadRequestException("you can't monitor your own call");
    const build = MONITOR_MODES[mode];
    if (!build) throw new BadRequestException(`mode must be one of ${Object.keys(MONITOR_MODES).join(', ')}`);
    // Team-scoped supervisors may only monitor their own team.
    const scope = await teamScopeIds(this.prisma, user);
    if (scope) {
      const target = await this.prisma.account.findFirst({ where: { tenantId: user.tenantId, agentExtension: targetExt }, select: { id: true } });
      if (!target || !scope.includes(target.id)) throw new ForbiddenException('you can only monitor your own team');
    }
    let rows: any[] = [];
    try { rows = JSON.parse(await this.fs.api('show channels as json')).rows ?? []; } catch { /* ignore */ }
    const uuid = this.findChannelUuid(rows, targetExt);
    if (!uuid) throw new NotFoundException('that agent is not on a call right now');
    const vars = `{park_after_bridge=true}`;
    const jobUuid = await this.fs.bgapi(`originate ${vars}user/${supervisorExt} &eavesdrop(${build(uuid)})`);
    return { ok: true, mode, target: targetExt, agent: supervisorExt, jobUuid };
  }

  // ---------- agent state (mod_callcenter) ----------

  private agentName(ext: string, domain: string) { return `${ext}@${domain}`; }

  /** Sign an agent in: ensure they exist, set contact, mark a status. */
  async setAgentStatus(extension: string, status: string) {
    if (!AGENT_STATUSES.includes(status as AgentStatus)) {
      throw new NotFoundException(`status must be one of ${AGENT_STATUSES.join(', ')}`);
    }
    const domain = await this.domain();
    const agent = this.agentName(extension, domain);
    // Ensure the agent exists (no-op if already added).
    await this.fs.api(`callcenter_config agent add ${agent} callback`).catch(() => {});
    await this.fs.api(`callcenter_config agent set contact ${agent} user/${extension}`).catch(() => {});
    // Re-offer tuning: without these a declined/missed call re-rings instantly
    // and forever. Delay re-offers after a reject/no-answer, give a short wrap-up
    // breather, and auto-park the agent On Break after a few consecutive misses.
    // NB: mod_callcenter times are in SECONDS (not ms) — a big wrap_up_time parks
    // the agent for that many seconds after every call.
    await this.fs.api(`callcenter_config agent set max_no_answer ${agent} 3`).catch(() => {});
    await this.fs.api(`callcenter_config agent set wrap_up_time ${agent} 3`).catch(() => {});
    await this.fs.api(`callcenter_config agent set reject_delay_time ${agent} 5`).catch(() => {});
    await this.fs.api(`callcenter_config agent set no_answer_delay_time ${agent} 5`).catch(() => {});
    const res = await this.fs.api(`callcenter_config agent set status ${agent} '${status}'`);
    return { extension, agent, status, result: res };
  }

  /** Raw mod_callcenter agent rows (name = ext@domain, plus status/state). */
  private async callcenterAgentRows(): Promise<Record<string, string>[]> {
    let body = '';
    try { body = await this.fs.api('callcenter_config agent list'); } catch { return []; }
    const lines = body.split('\n').filter((l) => l && !l.startsWith('+OK'));
    if (!lines.length) return [];
    const header = lines[0].split('|');
    return lines.slice(1).map((line) => {
      const cols = line.split('|');
      const row: Record<string, string> = {};
      header.forEach((h, i) => (row[h] = cols[i] ?? ''));
      return row;
    });
  }

  /**
   * Live agent board for supervisors: the tenant's agents (names + extensions)
   * overlaid with live signals — on a call (active channel), on break / logged
   * out (mod_callcenter), or registered (available). Plus today's workload from
   * the call logs (calls, connected, average handle time).
   */
  async listAgents(user: AuthUser) {
    // Team-scoped supervisors only see their own team on the board.
    const scope = await teamScopeIds(this.prisma, user);
    const accounts = await this.prisma.account.findMany({
      where: { tenantId: user.tenantId, agentExtension: { not: null }, ...(scope ? { id: { in: scope } } : {}) },
      select: { agentExtension: true, firstName: true, lastName: true, email: true },
    });
    if (!accounts.length) return [];

    // Live signals from FreeSWITCH (best-effort; empty if ESL is down).
    let chRows: any[] = [];
    const registered = new Set<string>();
    const ccStatus = new Map<string, string>();
    try { chRows = JSON.parse(await this.fs.api('show channels as json')).rows ?? []; } catch { /* ignore */ }
    try {
      const regRows = JSON.parse(await this.fs.api('show registrations as json')).rows ?? [];
      for (const r of regRows) if (r?.reg_user) registered.add(String(r.reg_user));
    } catch { /* ignore */ }
    for (const a of await this.callcenterAgentRows()) {
      const ext = String(a.name || '').split('@')[0];
      if (ext) ccStatus.set(ext, a.status || '');
    }

    // Today's workload per agent from the call logs.
    const since = new Date(); since.setHours(0, 0, 0, 0);
    const logs = await this.prisma.callLog.findMany({
      where: { tenantId: user.tenantId, startedAt: { gte: since } },
      select: { agentExt: true, durationSec: true },
    });
    const stat = new Map<string, { calls: number; conn: number; talk: number }>();
    for (const l of logs) {
      if (!l.agentExt) continue;
      const s = stat.get(l.agentExt) || { calls: 0, conn: 0, talk: 0 };
      s.calls++;
      if ((l.durationSec ?? 0) > 0) { s.conn++; s.talk += l.durationSec!; }
      stat.set(l.agentExt, s);
    }
    const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

    return accounts.map((a) => {
      const ext = a.agentExtension!;
      const onCall = !!this.findChannelUuid(chRows, ext);
      const cc = ccStatus.get(ext) || '';
      let status: string;
      if (onCall) status = 'on-call';
      else if (/logged out/i.test(cc)) status = 'offline';
      else if (/break/i.test(cc)) status = 'away';
      else if (registered.has(ext)) status = 'available';
      else status = 'offline';
      const s = stat.get(ext);
      return {
        extension: ext,
        name: [a.firstName, a.lastName].filter(Boolean).join(' ') || a.email,
        status,
        onCall,
        calls: s?.calls ?? 0,
        conn: s?.conn ?? 0,
        aht: s && s.conn ? mmss(Math.round(s.talk / s.conn)) : '0:00',
      };
    });
  }
}
