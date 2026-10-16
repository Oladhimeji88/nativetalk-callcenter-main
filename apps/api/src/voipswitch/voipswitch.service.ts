import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';

/**
 * Client for the VoipSwitch PortalAdmin WebAPI (a ServiceStack JSON service).
 *
 * One tenant == one VoipSwitch *retail* client (= one registering SIP trunk).
 * The working recipe, validated end-to-end against the live platform (an actual
 * PSTN call completed), is:
 *   - account type RETAIL (clientType 32) — the type that registers on this box
 *     (all live registrations are retail; wholesale clients do not register here)
 *   - reseller -1 (the platform/master level) — NOT a sub-reseller, whose tariffs
 *     lack outbound termination routes (those 402 "Payment Required")
 *   - an NGN ST_* tariff that has real Nigerian routes (e.g. ST_12)
 *   - a per-tenant DID (caller-id) + the carrier tech-prefix that selects the
 *     termination route: techPrefix = `CP:!<DID national>;DP:0->3344`
 *   - register auth (unique login/password per tenant)
 * FreeSWITCH then dials numbers in NATIONAL `0…` form so the `0->3344` rule fires.
 *
 * Calling convention (from .../VS.WebAPI.Admin/metadata):
 *   POST {API_URL}/json/syncreply/{operation}?format=json
 *   Authorization: Basic base64( "{adminLogin}#admin" : SHA1hex({adminPassword}) )
 * On error ServiceStack returns a `responseStatus` object with errorCode/message.
 *
 * Stays dormant (`configured === false`) until the VOIPSWITCH_* env vars are set,
 * so signup behaves exactly as before when it is not configured.
 */

export interface ProvisionedTrunk {
  provider: 'voipswitch';
  clientId: number;
  login: string;
  password: string;
  proxy: string;
  /** Caller-id (national `0…` form) assigned to the trunk, if a DID was allocated. */
  callerId?: string;
  /** The allocated DID number (as stored in the carrier pool), if any. */
  did?: string;
}

interface ResponseStatus {
  errorCode?: string;
  message?: string;
}

@Injectable()
export class VoipswitchService {
  private readonly logger = new Logger(VoipswitchService.name);

  constructor(private readonly config: ConfigService) {}

  private get<T = string>(key: string): T | undefined {
    return this.config.get<T>(key);
  }

  /** SIP registrar host the tenant gateway registers to (carrier proxy). */
  get proxy(): string {
    return this.get('VOIPSWITCH_SIP_PROXY') ?? '';
  }

  /** True once the minimum config to talk to the API is present. */
  get configured(): boolean {
    return Boolean(
      this.get('VOIPSWITCH_API_URL') &&
        this.get('VOIPSWITCH_ADMIN_LOGIN') &&
        this.get('VOIPSWITCH_ADMIN_PASSWORD') &&
        this.proxy &&
        this.get('VOIPSWITCH_TARIFF_ID'),
    );
  }

  // ---------- config ----------
  /** retail = 32 on this platform (the registering account type). */
  private get clientType(): number { return Number(this.get('VOIPSWITCH_CLIENT_TYPE') ?? 32); }
  private get resellerId(): number { return Number(this.get('VOIPSWITCH_RESELLER_ID') ?? -1); }
  private get tariffId(): number { return Number(this.get('VOIPSWITCH_TARIFF_ID')); }
  /** Dialed-number routing rule, appended after the caller-id (CP:) rule. MUST be
   *  `DP:`-prefixed: VoipSwitch stores one combined tech-prefix string and splits
   *  it — `CP:...` -> the client's CLI rules, `DP:...` -> the client's Dialing
   *  rules (the route selector). A bare `0->3344` (no `DP:`) lands in neither and
   *  is a no-op, so the client can't route. */
  private get techPrefixRule(): string { return this.get('VOIPSWITCH_TECH_PREFIX') ?? 'DP:0->3344 OR 234->3344'; }
  /** DID pool (country id) to allocate per-tenant numbers from; 0/unset disables. */
  private get didCountryId(): number { return Number(this.get('VOIPSWITCH_DID_COUNTRY_ID') ?? 0); }
  /** Free credit granted to a new client at signup (carrier currency). 0 = none. */
  private get starterCredit(): number { return Number(this.get('VOIPSWITCH_STARTER_CREDIT') ?? 0); }

  private authHeader(): string {
    const login = this.get('VOIPSWITCH_ADMIN_LOGIN') ?? '';
    const password = this.get('VOIPSWITCH_ADMIN_PASSWORD') ?? '';
    const sha1 = createHash('sha1').update(password).digest('hex');
    return 'Basic ' + Buffer.from(`${login}#admin:${sha1}`).toString('base64');
  }

  /** POST one operation and return its parsed JSON, throwing on API errors. */
  private async call<T = any>(operation: string, body: Record<string, any>): Promise<T> {
    const base = (this.get('VOIPSWITCH_API_URL') ?? '').replace(/\/+$/, '');
    const url = `${base}/json/syncreply/${operation}?format=json`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: this.authHeader() },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e: any) {
      throw new Error(`voipswitch ${operation} request failed: ${e?.message ?? e}`);
    }
    const text = await res.text();
    let data: any = {};
    try { data = text ? JSON.parse(text) : {}; } catch { /* non-JSON error body */ }
    const status: ResponseStatus | undefined = data?.responseStatus;
    if (!res.ok || status?.errorCode) {
      const msg = status?.message || status?.errorCode || text || `HTTP ${res.status}`;
      throw new Error(`voipswitch ${operation} error: ${msg}`);
    }
    return data as T;
  }

  /** Add prepaid credit to a client's carrier balance. Best-effort; amount<=0 no-ops. */
  async addCredit(clientId: number, amount: number, description = 'credit'): Promise<void> {
    if (!this.configured || !(amount > 0)) return;
    await this.call('admin.payment.add', {
      money: amount, paymentType: 'PrePaid', idClient: clientId,
      clientType: this.clientType, addToInvoice: false, description,
    });
  }

  /** Sanitised, length-bounded SIP login derived from a tenant slug. */
  private baseLogin(slug: string): string {
    const clean = slug.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 16) || 'tenant';
    return `tk_${clean}`;
  }

  /** Find a SIP login not already in use on the platform. */
  private async uniqueLogin(slug: string): Promise<string> {
    const base = this.baseLogin(slug);
    for (let attempt = 0; attempt < 6; attempt++) {
      const login = attempt === 0 ? base : `${base}_${randomBytes(2).toString('hex')}`;
      const { isUsed } = await this.call<{ isUsed: boolean }>('admin.client.check.login', { login });
      if (!isUsed) return login;
    }
    throw new Error('could not find a free SIP login after several attempts');
  }

  private newPassword(): string {
    return randomBytes(18).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 20);
  }

  /**
   * Allocate one Available DID from the configured pool and mark it Assigned.
   * Returns the raw pool number plus the national `0…` form used for caller-id.
   * Returns null when no pool is configured or none are free (caller-id is then
   * omitted — outbound still works via the tech-prefix rule).
   */
  private async allocateDid(): Promise<{ number: string; national: string } | null> {
    if (!this.didCountryId) return null;
    let avail: any;
    try {
      const list = await this.call<{ data: any[] }>('admin.did.local.number.list', {
        countryId: this.didCountryId, pageOffset: 0, pageSize: 200,
      });
      avail = (list.data ?? []).find((d) => d.status === 'Available');
    } catch (e: any) {
      this.logger.warn(`DID list failed for pool ${this.didCountryId}: ${e.message}`);
      return null;
    }
    if (!avail) { this.logger.warn(`no Available DID in pool ${this.didCountryId}`); return null; }
    try {
      await this.call('admin.did.local.number.save', {
        data: { id: avail.id, number: avail.number, areaId: avail.areaId, status: 'Assigned' },
      });
    } catch (e: any) {
      this.logger.warn(`DID reserve failed for ${avail.number}: ${e.message}`);
    }
    const national = '0' + String(avail.number).replace(/^0+/, '');
    return { number: String(avail.number), national };
  }

  /**
   * Create a registering retail trunk for a tenant, allocate a DID caller-id,
   * apply the carrier tech-prefix routing rule, and grant starter credit.
   */
  async provisionTrunk(opts: {
    slug: string;
    email?: string;
    company?: string;
    callsLimit?: number;
  }): Promise<ProvisionedTrunk> {
    if (!this.configured) throw new Error('voipswitch is not configured');

    const login = await this.uniqueLogin(opts.slug);
    const password = this.newPassword();

    const created = await this.call<{ idClient: number }>('admin.retail.create', {
      login,
      password,
      webPassword: password,
      eMail: opts.email ?? '',
      firstName: opts.company ?? opts.slug,
      tariffId: this.tariffId,
      accountState: Number(this.get('VOIPSWITCH_ACCOUNT_STATE') ?? 1),
      country: this.get('VOIPSWITCH_COUNTRY') ?? '',
      callsLimit: Number(opts.callsLimit ?? 0),
      postPaid: false,
      resellerId: this.resellerId,
    });

    const clientId = created.idClient;
    if (!clientId) throw new Error('voipswitch create returned no idClient');

    // Allocate a DID caller-id, then set the tech-prefix: caller-id presentation
    // (CP) + the carrier routing rule (DP) that selects the termination route.
    const did = await this.allocateDid();
    const techPrefix = did ? `CP:!${did.national};${this.techPrefixRule}` : this.techPrefixRule;
    try {
      await this.call('admin.client.techprefix.set', { clientId, techPrefix });
    } catch (e: any) {
      this.logger.warn(`techprefix.set failed for client ${clientId}: ${e.message}`);
    }
    if (did) {
      try {
        await this.call('admin.client.ani.add', {
          idClient: clientId, clientType: this.clientType,
          aniNumber: { phoneNumber: did.national, isDef: true },
        });
      } catch (e: any) {
        this.logger.warn(`ANI add failed for client ${clientId}: ${e.message}`);
      }
    }

    if (this.starterCredit > 0) {
      try { await this.addCredit(clientId, this.starterCredit, 'signup starter credit'); }
      catch (e: any) { this.logger.warn(`starter credit failed for client ${clientId}: ${e.message}`); }
    }

    this.logger.log(`provisioned voipswitch retail trunk ${clientId} (login ${login}, did ${did?.national ?? 'none'}) for ${opts.slug}`);
    return { provider: 'voipswitch', clientId, login, password, proxy: this.proxy, callerId: did?.national, did: did?.number };
  }

  /** Suspend or re-activate a tenant's trunk on the carrier. Best-effort. */
  async setActive(clientId: number, active: boolean): Promise<void> {
    if (!this.configured) return;
    await this.call('admin.client.status.set', { active, clientId, clientType: this.clientType });
  }
}

@Global()
@Module({
  providers: [VoipswitchService],
  exports: [VoipswitchService],
})
export class VoipswitchModule {}
