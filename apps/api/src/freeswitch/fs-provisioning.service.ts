import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { FreeswitchService } from './freeswitch.service';

const esc = (s: any) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Literal `$${domain}` — FreeSWITCH expands this global at config-parse time to
// the server's domain (e.g. 127.0.0.1). Written as a plain string to avoid
// template-literal `${...}` interpolation pitfalls.
const FS_DOMAIN = '$' + '${domain}';

export interface PbxConfig {
  tenantId?: string; // used to name per-tenant files so tenants don't overwrite each other
  extensions: any[];
  trunks: any[];
  ringGroups: any[];
  inboundRoutes: any[];
  ivrs: any[];
  queues: any[];
  timeConditions: any[];
}

/**
 * Turns the database PBX config into FreeSWITCH XML and applies it.
 *
 * We write ONE file per category (overwrite = implicit cleanup of deleted
 * entities), into the standard auto-included locations:
 *   directory/default/zzz_ucp_users.xml      (extensions)
 *   sip_profiles/external/zzz_ucp_gw.xml     (trunks/gateways)
 *   dialplan/default/zzz_ucp.xml             (ring groups, inbound routes, …)
 * then `reloadxml` + rescan the external profile.
 *
 * If the conf dir is not writable (e.g. Program Files without admin) apply
 * degrades gracefully and returns the generated XML so it can be applied on a
 * writable host instead.
 */
@Injectable()
export class FsProvisioningService {
  // Decoupled gateway sync active when FS_SSH_TARGET is set.
  private readonly logger = new Logger(FsProvisioningService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly fs: FreeswitchService,
  ) {}

  private confDir(): string {
    return this.config.get<string>('FS_CONF_DIR') ?? 'C:/Program Files/FreeSWITCH/conf';
  }

  // ---------- generators (pure) ----------

  directoryXml(extensions: any[]): string {
    const users = extensions
      .filter((e) => e.active !== false)
      .map(
        (e) => `    <user id="${esc(e.extension)}">
      <params>
        <param name="password" value="${esc(e.password)}"/>
        <param name="vm-password" value="${esc(e.extension)}"/>
      </params>
      <variables>
        <variable name="toll_allow" value="${esc(e.tollAllow ?? 'domestic,local')}"/>
        <variable name="accountcode" value="${esc(e.extension)}"/>
        <variable name="user_context" value="${esc(e.context ?? 'default')}"/>
        <variable name="effective_caller_id_name" value="${esc(e.callerIdName ?? e.displayName ?? 'Extension ' + e.extension)}"/>
        <variable name="effective_caller_id_number" value="${esc(e.callerIdNumber ?? e.extension)}"/>
      </variables>
    </user>`,
      )
      .join('\n');
    return `<include>\n${users}\n</include>\n`;
  }

  gatewaysXml(trunks: any[]): string {
    const gws = trunks
      .filter((t) => t.active !== false)
      .map(
        (t) => `  <gateway name="${esc(t.name)}">
    <param name="username" value="${esc(t.username)}"/>
    <param name="password" value="${esc(t.password)}"/>
    <param name="proxy" value="${esc(t.proxy)}"/>
    ${t.realm ? `<param name="realm" value="${esc(t.realm)}"/>` : ''}
    ${t.fromDomain ? `<param name="from-domain" value="${esc(t.fromDomain)}"/>` : ''}
    <param name="register" value="${t.register === false ? 'false' : 'true'}"/>
    ${t.callerId ? `<param name="caller-id-in-from" value="true"/>` : ''}
  </gateway>`,
      )
      .join('\n');
    return `<include>\n${gws}\n</include>\n`;
  }

  dialplanXml(cfg: PbxConfig): string {
    const blocks: string[] = [];

    for (const rg of cfg.ringGroups.filter((r) => r.active !== false)) {
      const members: string[] = Array.isArray(rg.members) ? rg.members : [];
      const sep = rg.strategy === 'sequential' ? '|' : ',';
      const dial = members.map((m) => `user/${esc(m)}`).join(sep);
      const failover = rg.failoverDest
        ? `\n        <action application="transfer" data="${esc(rg.failoverDest)} XML default"/>`
        : '';
      blocks.push(`  <extension name="ucp_ringgroup_${esc(rg.number)}">
    <condition field="destination_number" expression="^${esc(rg.number)}$">
      <action application="set" data="call_timeout=${Number(rg.timeoutSec) || 25}"/>
      <action application="bridge" data="${dial}"/>${failover}
    </condition>
  </extension>`);
    }

    for (const r of cfg.inboundRoutes.filter((x) => x.active !== false)) {
      let action = '';
      switch (r.destinationType) {
        case 'hangup': action = `<action application="hangup" data="NORMAL_CLEARING"/>`; break;
        case 'voicemail': action = `<action application="answer"/>\n      <action application="voicemail" data="default $${'{domain}'} ${esc(r.destination)}"/>`; break;
        default: action = `<action application="transfer" data="${esc(r.destination)} XML default"/>`;
      }
      blocks.push(`  <extension name="ucp_inbound_${esc(r.did)}">
    <condition field="destination_number" expression="^${esc(r.did)}$">
      ${action}
    </condition>
  </extension>`);
    }

    // IVR menus — implemented with mod_dptools (play_and_get_digits) so they work
    // without mod_ivr. The menu collects one digit then routes via per-option
    // helper extensions; no/invalid input falls through to invalidDest.
    for (const ivr of cfg.ivrs.filter((x) => x.active !== false)) {
      const opts: Record<string, any> = (ivr.options && typeof ivr.options === 'object') ? ivr.options : {};
      const ms = (Number(ivr.timeoutSec) || 5) * 1000;
      const greet = esc(ivr.greeting || 'ivr/ivr-welcome_to_freeswitch.wav');
      const invalid = esc(ivr.invalidDest || ivr.number);
      blocks.push(`  <extension name="ucp_ivr_${esc(ivr.number)}">
    <condition field="destination_number" expression="^${esc(ivr.number)}$">
      <action application="answer"/>
      <action application="sleep" data="500"/>
      <action application="play_and_get_digits" data="1 1 3 ${ms} # ${greet} ${greet} ucp_ivr_digit \\d 1000 ''"/>
      <action application="execute_extension" data="ucp_ivropt_${esc(ivr.number)}_$${'{ucp_ivr_digit}'} XML default"/>
      <action application="transfer" data="${invalid} XML default"/>
    </condition>
  </extension>`);
      for (const [digit, opt] of Object.entries(opts)) {
        const dest = esc((opt as any)?.destination ?? '');
        if (!dest) continue;
        blocks.push(`  <extension name="ucp_ivropt_${esc(ivr.number)}_${esc(digit)}">
    <condition field="destination_number" expression="^ucp_ivropt_${esc(ivr.number)}_${esc(digit)}$">
      <action application="transfer" data="${dest} XML default"/>
    </condition>
  </extension>`);
      }
    }

    // Queues — caller is placed into a mod_callcenter queue. The queue itself is
    // defined in callcenterQueuesXml(); agents/tiers are provisioned live in apply().
    for (const qd of cfg.queues.filter((x) => x.active !== false)) {
      blocks.push(`  <extension name="ucp_queue_${esc(qd.number)}">
    <condition field="destination_number" expression="^${esc(qd.number)}$">
      <action application="answer"/>
      <action application="callcenter" data="q-${esc(qd.id)}@default"/>
    </condition>
  </extension>`);
    }

    // Time conditions — route by business hours (first range). Matches the number,
    // then checks day/time; match → matchDest, otherwise → noMatchDest.
    for (const tc of cfg.timeConditions.filter((x) => x.active !== false)) {
      const ranges: any[] = Array.isArray(tc.ranges) ? tc.ranges : [];
      const r0 = ranges[0] || {};
      const tod = r0.timeStart && r0.timeEnd ? ` time-of-day="${esc(r0.timeStart)}:00-${esc(r0.timeEnd)}:00"` : '';
      const wday = r0.wday ? ` wday="${esc(r0.wday)}"` : '';
      const matchDest = esc(tc.matchDest || '');
      const noMatchDest = esc(tc.noMatchDest || '');
      blocks.push(`  <extension name="ucp_tc_${esc(tc.number)}">
    <condition field="destination_number" expression="^${esc(tc.number)}$" break="never"/>
    <condition${tod}${wday}>
      ${matchDest ? `<action application="transfer" data="${matchDest} XML default"/>` : '<action application="set" data="tc_match=true"/>'}
      ${noMatchDest ? `<anti-action application="transfer" data="${noMatchDest} XML default"/>` : ''}
    </condition>
  </extension>`);
    }

    // Outbound: route external numbers out via the tenant's registering trunk.
    // We normalise any of E.164 (234…), 00-international, or bare-10-digit input to
    // the NATIONAL `0…` form the carrier expects — its tech-prefix rule (e.g.
    // `0->3344`) keys off the leading 0 to select the termination route. The 10+
    // significant-digit match never collides with internal extensions (3–4 digits).
    const trunk = cfg.trunks.find((t) => t.active !== false);
    if (trunk) {
      const cid = trunk.callerId
        ? `\n      <action application="set" data="effective_caller_id_number=${esc(trunk.callerId)}"/>`
        : '';
      blocks.push(`  <extension name="ucp_outbound_${esc(trunk.name)}">
    <condition field="destination_number" expression="^(?:\\+?234|00234|0)?(\\d{10})$">${cid}
      <action application="bridge" data="sofia/gateway/${esc(trunk.name)}/0$1"/>
    </condition>
  </extension>`);
    }

    return `<include>\n${blocks.join('\n')}\n</include>\n`;
  }

  // mod_callcenter queue definitions (textually included into callcenter.conf.xml's
  // <queues> section). $${domain} expands at parse time to the FS domain.
  callcenterQueuesXml(queues: any[]): string {
    const qs = queues
      .filter((q) => q.active !== false)
      .map(
        (q) => `    <queue name="q-${esc(q.id)}@default">
      <param name="strategy" value="${esc(q.strategy || 'ring-all')}"/>
      <param name="moh-sound" value="${esc(q.moh || '$${hold_music}')}"/>
      <param name="max-wait-time" value="${(Number(q.maxWaitSec) || 300) * 1000}"/>
      <param name="tier-rules-apply" value="false"/>
      <param name="discard-abandoned-after" value="60"/>
    </queue>`,
      )
      .join('\n');
    return `${qs}\n`;
  }

  generateAll(cfg: PbxConfig) {
    return {
      'directory/default/zzz_ucp_users.xml': this.directoryXml(cfg.extensions),
      'sip_profiles/external/zzz_ucp_gw.xml': this.gatewaysXml(cfg.trunks),
      'dialplan/default/zzz_ucp.xml': this.dialplanXml(cfg),
      'autoload_configs/callcenter_ucp_queues.xml': this.callcenterQueuesXml(cfg.queues),
    };
  }

  /**
   * One-time, idempotent: make callcenter.conf.xml textually include our
   * generated queues file inside its <queues> section. Without this the queues
   * we generate are never seen by mod_callcenter.
   */
  private async ensureCallcenterInclude(base: string): Promise<void> {
    const file = path.join(base, 'autoload_configs/callcenter.conf.xml');
    const marker = 'callcenter_ucp_queues.xml';
    let xml: string;
    try {
      xml = await readFile(file, 'utf8');
    } catch {
      return; // callcenter not installed here; nothing to wire
    }
    if (xml.includes(marker)) return;
    const include = `  <queues>\n    <X-PRE-PROCESS cmd="include" data="${marker}"/>`;
    const next = xml.replace(/<queues>/, include);
    if (next !== xml) await writeFile(file, next, 'utf8');
  }

  /**
   * Live mod_callcenter provisioning: load queues from the (reloaded) XML and
   * add each queue's member extensions as agents + tiers at runtime.
   */
  private async provisionCallcenter(cfg: PbxConfig): Promise<void> {
    const queues = cfg.queues.filter((q) => q.active !== false);
    if (!queues.length || !this.fs.isConnected()) return;
    let domain = '';
    try { domain = (await this.fs.api('global_getvar domain')).trim(); } catch { /* ignore */ }
    domain = domain || '127.0.0.1';
    for (const q of queues) {
      // Keyed by id (matches callcenter.conf + buildRoute), not the dialable number.
      const qn = `q-${q.id}@default`;
      try { await this.fs.api(`callcenter_config queue load ${qn}`); } catch { /* already loaded */ }
      const members: string[] = Array.isArray(q.members) ? q.members : [];
      for (const ext of members) {
        const agent = `${ext}@${domain}`;
        try {
          await this.fs.api(`callcenter_config agent add ${agent} callback`);
          await this.fs.api(`callcenter_config agent set contact ${agent} user/${ext}`);
          await this.fs.api(`callcenter_config agent set status ${agent} 'Available'`);
          await this.fs.api(`callcenter_config tier add ${qn} ${agent} 1 1`);
        } catch { /* idempotent best-effort */ }
      }
    }
  }

  // ---------- apply ----------

  async apply(cfg: PbxConfig): Promise<{ applied: boolean; reason?: string; reload?: string; files: string[]; preview: Record<string, string> }> {
    const files = this.generateAll(cfg);

    // Decoupled deployment: FreeSWITCH is on a separate box. Directory, dialplan
    // and callcenter config are pulled live over xml_curl, but Sofia gateways
    // can't be — they must exist as files on the FS box. So push just the gateway
    // file over SSH and rescan the external profile over ESL.
    const sshTarget = this.config.get<string>('FS_SSH_TARGET');
    if (sshTarget) return this.applyRemote(cfg, files, sshTarget);

    const base = this.confDir();
    try {
      for (const [rel, content] of Object.entries(files)) {
        const full = path.join(base, rel);
        await mkdir(path.dirname(full), { recursive: true });
        await writeFile(full, content, 'utf8');
      }
    } catch (e: any) {
      const reason =
        e.code === 'EPERM' || e.code === 'EACCES'
          ? `FreeSWITCH conf dir is not writable (${e.code}) at ${base}. Run with write access (admin / correct owner) or set FS_CONF_DIR to a writable conf.`
          : e.message;
      this.logger.warn(`apply skipped: ${reason}`);
      return { applied: false, reason, files: Object.keys(files), preview: files };
    }

    // Wire mod_callcenter to read our queues (idempotent, before reload).
    try { await this.ensureCallcenterInclude(base); } catch (e: any) { this.logger.warn(`callcenter include: ${e.message}`); }

    let reload = 'skipped (FreeSWITCH not connected)';
    if (this.fs.isConnected()) {
      try {
        reload = await this.fs.api('reloadxml');
        if (cfg.trunks.length) await this.fs.api('sofia profile external rescan reloadxml');
        await this.provisionCallcenter(cfg);
      } catch (e: any) {
        reload = `reload error: ${e.message}`;
      }
    }
    return { applied: true, reload, files: Object.keys(files), preview: files };
  }

  /**
   * Decoupled apply: push the Sofia gateway file to the remote FS box over SSH,
   * then rescan the external profile + provision callcenter over ESL. Best-effort
   * and never throws into the caller (a sync is fire-and-forget).
   */
  private async applyRemote(
    cfg: PbxConfig,
    files: Record<string, string>,
    sshTarget: string,
  ): Promise<{ applied: boolean; reason?: string; reload?: string; files: string[]; preview: Record<string, string> }> {
    const dir = (this.config.get<string>('FS_GATEWAY_DIR') ?? '/etc/freeswitch/sip_profiles/external').replace(/\/+$/, '');
    // Per-tenant file (the external profile includes external/*.xml) so one
    // tenant's sync never overwrites another's gateways.
    const tag = (cfg.tenantId || 'default').replace(/[^a-zA-Z0-9_-]/g, '');
    const remotePath = `${dir}/zzz_ucp_gw_${tag}.xml`;
    let applied = false;
    let reason: string | undefined;
    try {
      await this.sshWriteFile(sshTarget, remotePath, files['sip_profiles/external/zzz_ucp_gw.xml']);
      applied = true;
    } catch (e: any) {
      reason = `gateway push to ${sshTarget}:${remotePath} failed: ${e.message}`;
      this.logger.warn(reason);
    }

    let reload = 'skipped (FreeSWITCH not connected)';
    if (this.fs.isConnected()) {
      try {
        reload = await this.fs.api('reloadxml');
        await this.fs.api('sofia profile external rescan reloadxml');
        await this.provisionCallcenter(cfg);
      } catch (e: any) {
        reload = `reload error: ${e.message}`;
      }
    }
    return { applied, reason, reload, files: Object.keys(files), preview: files };
  }

  /** Write `content` to `remotePath` on the FS box over SSH (via `sudo tee`). */
  private sshWriteFile(target: string, remotePath: string, content: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const useSudo = this.config.get<string>('FS_SSH_SUDO') !== 'false';
      const args = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=accept-new'];
      const key = this.config.get<string>('FS_SSH_KEY');
      if (key) args.push('-i', key);
      const port = this.config.get<string>('FS_SSH_PORT');
      if (port) args.push('-p', port);
      args.push(target, `${useSudo ? 'sudo -n ' : ''}tee ${remotePath} >/dev/null`);
      const child = spawn('ssh', args);
      let stderr = '';
      child.stderr.on('data', (d) => (stderr += d.toString()));
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ssh exit ${code}: ${stderr.trim()}`))));
      child.stdin.on('error', () => { /* ignore EPIPE if ssh dies early */ });
      child.stdin.write(content);
      child.stdin.end();
    });
  }
}
