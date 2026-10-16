import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

// Escape a value for safe inclusion in XML attributes/text.
function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// FreeSWITCH's "config not found" document — tells FS to fall back to static
// files (or treat as no match).
const NOT_FOUND = `<document type="freeswitch/xml">
  <section name="result">
    <result status="not found"/>
  </section>
</document>`;

// A mod_callcenter <queue> block with our standard settings (matches the box's
// static support@default). Agents/tiers are attached live over ESL, not here.
// Dialer queues cap the caller's hold so an over-dialed call that never reaches
// an agent is released (and apologised to) rather than held in silence forever.
// Seconds; 0 = unlimited (inbound support queue keeps this).
const DIALER_MAX_WAIT_SEC = 45;

function ccQueueBlock(name: string, maxWaitSec = 0, strategy = 'longest-idle-agent', moh = '$${hold_music}'): string {
  return `        <queue name="${esc(name)}">
          <param name="strategy" value="${esc(strategy)}"/>
          <param name="moh-sound" value="${esc(moh)}"/>
          <param name="time-base-score" value="system"/>
          <param name="max-wait-time" value="${Number(maxWaitSec) || 0}"/>
          <param name="max-wait-time-with-no-agent" value="0"/>
          <param name="max-wait-time-with-no-agent-time-reached" value="5"/>
          <param name="tier-rules-apply" value="false"/>
          <param name="tier-rule-wait-second" value="300"/>
          <param name="tier-rule-wait-multiply-level" value="true"/>
          <param name="tier-rule-no-agent-no-wait" value="false"/>
          <param name="discard-abandoned-after" value="60"/>
          <param name="abandoned-resume-allowed" value="false"/>
        </queue>`;
}

/**
 * Serves FreeSWITCH XML on demand for mod_xml_curl. Currently handles the
 * `directory` section (users/extensions for registration + auth), sourced from
 * Postgres so extensions are provisioned without writing files. Other sections
 * return "not found" so FreeSWITCH uses its static config.
 */
@Injectable()
export class FsXmlService {
  private readonly logger = new Logger(FsXmlService.name);

  constructor(private prisma: PrismaService, private config: ConfigService) {}

  notFound() { return NOT_FOUND; }

  /** Map an incoming SIP domain to a tenant. Supports per-tenant subdomains
   *  (`<slug>.<FS_SIP_BASE_DOMAIN>`) and a single-domain fallback for testing. */
  private async resolveTenant(domain?: string) {
    const base = this.config.get<string>('FS_SIP_BASE_DOMAIN');
    if (base && domain && domain.endsWith(`.${base}`)) {
      const slug = domain.slice(0, -(base.length + 1));
      const t = await this.prisma.tenant.findUnique({ where: { slug } });
      if (t) return t;
    }
    const defSlug = this.config.get<string>('FS_DEFAULT_TENANT_SLUG');
    if (defSlug) {
      const t = await this.prisma.tenant.findUnique({ where: { slug: defSlug } });
      if (t) return t;
    }
    return this.prisma.tenant.findFirst({ orderBy: { createdAt: 'asc' } });
  }

  /** The SIP domain a tenant's extensions register under. */
  private tenantDomain(slug: string): string {
    const base = this.config.get<string>('FS_SIP_BASE_DOMAIN');
    return base ? `${slug}.${base}` : '$${domain}';
  }

  /** Build the directory XML for a registration/user-call lookup. */
  async directory(params: Record<string, string>): Promise<string> {
    const number = params.user || params.key_value || params.sip_auth_username;
    const domain = params.domain || params.sip_auth_realm || params.sip_to_host || '';
    if (!number) return NOT_FOUND;

    const tenant = await this.resolveTenant(domain);
    if (!tenant) { this.logger.warn(`directory: no tenant for domain "${domain}"`); return NOT_FOUND; }

    const ext = await this.prisma.extension.findFirst({
      where: { tenantId: tenant.id, extension: number, active: true },
    });
    if (!ext) { this.logger.debug(`directory: ext ${number} not found for tenant ${tenant.slug}`); return NOT_FOUND; }

    const dom = domain || '$${domain}';
    // FreeSWITCH variables (${...}) are escaped with \$ so JS doesn't interpolate them.
    return `<document type="freeswitch/xml">
  <section name="directory">
    <domain name="${esc(dom)}">
      <params>
        <param name="dial-string" value="{^^:sip_invite_domain=\${dialed_domain}:presence_id=\${dialed_user}@\${dialed_domain}}\${sofia_contact(*/\${dialed_user}@\${dialed_domain})}"/>
      </params>
      <groups>
        <group name="default">
          <users>
            <user id="${esc(ext.extension)}">
              <params>
                <param name="password" value="${esc(ext.password)}"/>
                <param name="vm-password" value="${esc(ext.extension)}"/>
              </params>
              <variables>
                <variable name="user_context" value="${esc(tenant.slug)}"/>
                <variable name="tenant_id" value="${esc(tenant.id)}"/>
                <variable name="tenant_slug" value="${esc(tenant.slug)}"/>
                <variable name="effective_caller_id_name" value="${esc(ext.callerIdName || ext.displayName || ext.extension)}"/>
                <variable name="effective_caller_id_number" value="${esc(ext.callerIdNumber || ext.extension)}"/>
                <variable name="toll_allow" value="${esc(ext.tollAllow || 'domestic,local')}"/>
              </variables>
            </user>
          </users>
        </group>
      </groups>
    </domain>
  </section>
</document>`;
  }

  /** Build dialplan XML for one call. FreeSWITCH gives us the dialled number and
   *  the caller's context (which we stamped as the tenant slug in the directory);
   *  we return only the matching route. */
  async dialplan(params: Record<string, string>): Promise<string> {
    const dest = params['Caller-Destination-Number'] || params['Hunt-Destination-Number'] || params.destination_number;
    const context = params['Caller-Context'] || params['Hunt-Context'] || params.context || '';
    const reqDomain = params['variable_domain_name'] || params['variable_sip_req_host'] || params['variable_sip_from_host'] || '';
    if (!dest) return NOT_FOUND;

    // Tenant is identified by the call context (= slug), falling back to domain.
    let tenant = context ? await this.prisma.tenant.findUnique({ where: { slug: context } }) : null;
    if (!tenant) tenant = await this.resolveTenant(reqDomain);
    if (!tenant) { this.logger.warn(`dialplan: no tenant for context "${context}" / domain "${reqDomain}"`); return NOT_FOUND; }

    const domain = reqDomain || this.tenantDomain(tenant.slug);
    const route = await this.buildRoute(tenant.id, dest, domain);
    if (!route) { this.logger.debug(`dialplan: no route for ${dest} (tenant ${tenant.slug})`); return NOT_FOUND; }

    return `<document type="freeswitch/xml">
  <section name="dialplan">
    <context name="${esc(context || tenant.slug)}">
${route}
    </context>
  </section>
</document>`;
  }

  /**
   * Serve a module's `configuration` section. Only `callcenter.conf` is handled
   * (so the progressive dialer gets a dedicated ACD queue per campaign without
   * editing files on the FreeSWITCH box); every other config returns "not found"
   * so FreeSWITCH keeps using its static file. Agents/tiers are managed live over
   * ESL, so they're intentionally empty here.
   */
  async configuration(params: Record<string, string>): Promise<string> {
    const which = params.key_value || params['key_value'] || '';
    if (which !== 'callcenter.conf') return NOT_FOUND;

    // Keep the default queue; add one dedicated queue per agent-mode campaign
    // (loaded on demand by the dialer via `callcenter_config queue load`).
    const queues: string[] = [ccQueueBlock('support@default')];
    const campaigns = await this.prisma.outboundCampaign.findMany({
      where: { dialMethod: { in: ['Progressive', 'Power', 'Predictive'] } },
      select: { id: true },
    });
    for (const c of campaigns) queues.push(ccQueueBlock(`cc-${c.id}@default`, DIALER_MAX_WAIT_SEC));

    // Add every tenant's inbound ACD queue. callcenter.conf is box-wide, so we key
    // the queue by its (globally-unique) id — `q-<id>@default` — to avoid tenants
    // colliding on the same dialable number. buildRoute + provisionCallcenter use
    // the same name.
    const tenantQueues = await this.prisma.queue.findMany({
      where: { active: true },
      select: { id: true, strategy: true, moh: true, maxWaitSec: true },
    });
    for (const q of tenantQueues) {
      queues.push(ccQueueBlock(`q-${q.id}@default`, q.maxWaitSec ?? 0, q.strategy || 'longest-idle-agent', q.moh || '$${hold_music}'));
    }

    this.logger.log(`configuration: served callcenter.conf with ${queues.length} queue(s)`);
    return `<document type="freeswitch/xml">
  <section name="configuration">
    <configuration name="callcenter.conf" description="CallCenter">
      <settings>
        <param name="odbc-dsn" value=""/>
      </settings>
      <queues>
${queues.join('\n')}
      </queues>
      <agents></agents>
      <tiers></tiers>
    </configuration>
  </section>
</document>`;
  }

  /** Resolve the dialled number to a single dialplan <extension> block, or null. */
  private async buildRoute(tenantId: string, dest: string, domain: string): Promise<string | null> {
    const where = { tenantId, active: true as const };

    // 1) Internal extension → bridge to the registered user.
    const ext = await this.prisma.extension.findFirst({ where: { ...where, extension: dest } });
    if (ext) {
      return this.ext('ucp_ext', dest, `<action application="bridge" data="user/${esc(dest)}@${esc(domain)}"/>`);
    }

    // 1b) Dialer queue entry (answered outbound customer leg). Join the campaign
    // queue; if the caller is released without ever reaching an agent (queue
    // max-wait), the callcenter app returns on a still-live channel and we play a
    // short apology before hanging up. On a successful bridge the channel is torn
    // down when the agent ends, so the trailing actions are simply no-ops.
    const ccx = dest.match(/^ccx-(.+)$/);
    if (ccx) {
      const camp = await this.prisma.outboundCampaign.findFirst({ where: { tenantId, id: ccx[1] }, select: { id: true } });
      if (camp) {
        return this.ext('ucp_ccx', dest,
          `<action application="answer"/>\n      <action application="callcenter" data="cc-${esc(camp.id)}@default"/>\n` +
          `      <action application="playback" data="ivr/ivr-im_sorry.wav"/>\n` +
          `      <action application="playback" data="ivr/ivr-thank_you_for_calling.wav"/>\n` +
          `      <action application="hangup" data="NORMAL_CLEARING"/>`);
      }
    }

    // 2) ACD queue → mod_callcenter.
    const queue = await this.prisma.queue.findFirst({ where: { ...where, number: dest } });
    if (queue) {
      // Queue is keyed by id in the shared callcenter.conf (see configuration()).
      return this.ext('ucp_queue', dest,
        `<action application="answer"/>\n      <action application="callcenter" data="q-${esc(queue.id)}@default"/>`);
    }

    // 3) Ring group → bridge members (simultaneous or sequential).
    const rg = await this.prisma.ringGroup.findFirst({ where: { ...where, number: dest } });
    if (rg) {
      const members: string[] = Array.isArray(rg.members) ? (rg.members as string[]) : [];
      const sep = rg.strategy === 'sequential' ? '|' : ',';
      const dial = members.map((m) => `user/${esc(m)}@${esc(domain)}`).join(sep);
      const failover = rg.failoverDest ? `\n      <action application="transfer" data="${esc(rg.failoverDest)} XML ${esc('$${dialplan_context}')}"/>` : '';
      return this.ext('ucp_ringgroup', dest,
        `<action application="set" data="call_timeout=${Number(rg.timeoutSec) || 25}"/>\n      <action application="bridge" data="${dial}"/>${failover}`);
    }

    // 4) IVR menu.
    const ivr = await this.prisma.ivr.findFirst({ where: { ...where, number: dest } });
    if (ivr) {
      const ms = (Number(ivr.timeoutSec) || 5) * 1000;
      const greet = esc(ivr.greeting || 'ivr/ivr-welcome_to_freeswitch.wav');
      return this.ext('ucp_ivr', dest,
        `<action application="answer"/>\n      <action application="play_and_get_digits" data="1 1 3 ${ms} # ${greet} ${greet} ucp_ivr_digit \\d 1000"/>\n      <action application="transfer" data="\${ucp_ivr_digit} XML \${dialplan_context}"/>`);
    }

    // 5) Inbound DID mapping.
    const inbound = await this.prisma.inboundRoute.findFirst({ where: { ...where, did: dest } });
    if (inbound) {
      let action: string;
      switch (inbound.destinationType) {
        case 'hangup':    action = `<action application="hangup" data="NORMAL_CLEARING"/>`; break;
        case 'voicemail': action = `<action application="answer"/>\n      <action application="voicemail" data="default ${esc(domain)} ${esc(inbound.destination ?? '')}"/>`; break;
        default:          action = `<action application="transfer" data="${esc(inbound.destination ?? '')} XML \${dialplan_context}"/>`;
      }
      return this.ext('ucp_inbound', dest, action);
    }

    // 6) Outbound: an external number → out via the tenant's active trunk.
    // Accept national (0…), bare 10-digit, and E.164 (+234…/234…/00234…); all
    // normalise to the 0-prefixed national form the carrier's tech-prefix wants.
    if (/^(?:\+?234|00234|0)?\d{10}$/.test(dest)) {
      const trunk = await this.prisma.trunk.findFirst({ where: { ...where } });
      if (trunk) {
        const cid = trunk.callerId ? `\n      <action application="set" data="effective_caller_id_number=${esc(trunk.callerId)}"/>` : '';
        return `    <extension name="ucp_outbound">
      <condition field="destination_number" expression="^(?:\\+?234|00234|0)?(\\d{10})$">${cid}
        <action application="bridge" data="sofia/gateway/${esc(trunk.name)}/0$1"/>
      </condition>
    </extension>`;
      }
    }

    return null;
  }

  // Wrap a single action list in an exact-match <extension>.
  private ext(name: string, dest: string, actions: string): string {
    return `    <extension name="${esc(name)}_${esc(dest)}">
      <condition field="destination_number" expression="^${esc(dest)}$">
        ${actions}
      </condition>
    </extension>`;
  }
}
