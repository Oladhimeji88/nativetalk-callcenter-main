import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { getPaymentProvider } from './payment';
import { VoipswitchService } from '../voipswitch/voipswitch.service';
import { ensureSystemDispositions } from '../dialer/system-dispositions';
import { PbxService } from '../pbx/pbx.service';

const DEFAULT_LIMITS = { maxExtensions: 10, maxConcurrentCalls: 5, maxCampaigns: 5 };

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private prisma: PrismaService,
    private voipswitch: VoipswitchService,
    private pbx: PbxService,
  ) {}

  /**
   * Auto-provision the tenant's SIP trunk on the carrier (one client == one
   * trunk), persist a Trunk row with the returned SIP credentials, and push the
   * gateway to FreeSWITCH. Best-effort: a carrier/FS outage must never fail
   * signup — the tenant is created without telephony and an admin can
   * re-provision later. No-op when VoipSwitch is not configured.
   */
  private async provisionTrunk(tenant: { id: string; name: string; slug: string }, email: string): Promise<void> {
    if (!this.voipswitch.configured) return;
    try {
      const limits = this.effectiveLimits(await this.prisma.tenant.findUnique({ where: { id: tenant.id }, include: { plan: true } }));
      const t = await this.voipswitch.provisionTrunk({
        slug: tenant.slug,
        email,
        company: tenant.name,
        callsLimit: Number(limits.maxConcurrentCalls) || 0,
      });
      await this.prisma.trunk.create({
        data: {
          tenantId: tenant.id,
          // Gateway name must be globally unique in FreeSWITCH — use the SIP login
          // (one per tenant), not a constant, or tenants' gateways would collide.
          name: t.login,
          username: t.login,
          password: t.password,
          proxy: t.proxy,
          register: true,
          active: true,
          callerId: t.callerId ?? null,
          provider: t.provider,
          providerClientId: t.clientId,
        },
      });
      await this.pbx.safeSync(tenant.id);
    } catch (e: any) {
      this.logger.error(`trunk provisioning failed for tenant ${tenant.slug}: ${e.message}`);
    }
  }

  // ---------- limits & usage ----------
  effectiveLimits(tenant: any): Record<string, number> {
    return { ...DEFAULT_LIMITS, ...(tenant?.plan?.limits ?? {}), ...(tenant?.limits ?? {}) };
  }

  async usage(tenantId: string) {
    const periodStart = new Date(); periodStart.setDate(1); periodStart.setHours(0, 0, 0, 0);
    const [extensions, campaigns, agents, callsThisPeriod] = await Promise.all([
      this.prisma.extension.count({ where: { tenantId } }),
      this.prisma.outboundCampaign.count({ where: { tenantId } }),
      this.prisma.account.count({ where: { tenantId } }),
      this.prisma.callAttempt.count({ where: { tenantId, startedAt: { gte: periodStart } } }),
    ]);
    return { extensions, campaigns, agents, callsThisPeriod };
  }

  /** Current tenant's plan, subscription, usage and limits. */
  async me(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, include: { plan: true } });
    if (!tenant) throw new NotFoundException('tenant not found');
    const sub = await this.prisma.subscription.findFirst({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
    return {
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, status: tenant.status },
      plan: tenant.plan ? { id: tenant.plan.id, name: tenant.plan.name, priceMonthly: tenant.plan.priceMonthly, currency: tenant.plan.currency } : null,
      subscription: sub,
      limits: this.effectiveLimits(tenant),
      usage: await this.usage(tenantId),
    };
  }

  // ---------- platform / tenants ----------
  async listTenants() {
    const tenants = await this.prisma.tenant.findMany({ include: { plan: true }, orderBy: { createdAt: 'asc' } });
    return Promise.all(tenants.map(async (t) => ({
      id: t.id, name: t.name, slug: t.slug, status: t.status,
      plan: t.plan?.name ?? null,
      usage: await this.usage(t.id),
    })));
  }

  async onboardTenant(dto: { name: string; adminEmail: string; adminPassword: string; planId?: string }) {
    if (!dto.name?.trim() || !dto.adminEmail?.trim() || !dto.adminPassword) {
      throw new BadRequestException('name, adminEmail and adminPassword are required');
    }
    const slug = await this.uniqueSlug(dto.name);
    const tenant = await this.prisma.tenant.create({
      data: { name: dto.name.trim(), slug, status: 'active', planId: dto.planId ?? null, branding: { name: dto.name.trim() } },
    });
    // Default admin role (full access) + first admin account.
    // Full-access role for the new company's admin. Access is permission-first, so
    // every switch must be on (an empty set would lock the admin out entirely).
    const adminPerms: Record<string, { enabled: boolean }> = {};
    for (const k of ['softphone', 'contacts', 'live', 'queues', 'campaigns', 'recordings', 'analytics', 'pbx', 'users', 'billing', 'team']) {
      adminPerms[k] = { enabled: true };
    }
    const role = await this.prisma.role.create({
      data: { tenantId: tenant.id, name: 'Administrator', isSystem: true, permissions: adminPerms },
    });
    await this.prisma.account.create({
      data: {
        tenantId: tenant.id, email: dto.adminEmail.toLowerCase().trim(),
        passwordHash: await AuthService.hash(dto.adminPassword),
        firstName: 'Admin', roleId: role.id, active: true,
      },
    });
    if (dto.planId) await this.setPlan(tenant.id, dto.planId);
    await ensureSystemDispositions(this.prisma, tenant.id);
    await this.provisionTrunk({ id: tenant.id, name: tenant.name, slug }, dto.adminEmail);
    return { tenant: { id: tenant.id, name: tenant.name, slug }, adminEmail: dto.adminEmail };
  }

  /**
   * Self-service signup (public). Creates a tenant in `trial` status plus its
   * first admin. Differs from onboardTenant() in that anyone can call it, so it
   * is stricter: a minimum password length and a GLOBAL email-uniqueness check
   * (login resolves accounts by email across all tenants, so a duplicate email
   * would shadow an existing login). Returns no token — the client logs in with
   * the same credentials right after.
   */
  async registerTenant(dto: { company: string; email: string; password: string; firstName?: string; lastName?: string; planId?: string }) {
    const company = dto.company?.trim();
    const email = dto.email?.toLowerCase().trim();
    if (!company || !email || !dto.password) {
      throw new BadRequestException('company, email and password are required');
    }
    if (dto.password.length < 8) throw new BadRequestException('password must be at least 8 characters');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new BadRequestException('a valid email is required');

    const existing = await this.prisma.account.findFirst({ where: { email } });
    if (existing) throw new BadRequestException('an account with that email already exists');

    let planId: string | null = null;
    if (dto.planId) {
      const plan = await this.prisma.plan.findFirst({ where: { id: dto.planId, active: true } });
      if (!plan) throw new BadRequestException('the selected plan is not available');
      planId = plan.id;
    }

    const slug = await this.uniqueSlug(company);
    const tenant = await this.prisma.tenant.create({
      data: { name: company, slug, status: 'trial', planId, branding: { name: company } },
    });
    // Full-access role for the new company's admin. Access is permission-first, so
    // every switch must be on (an empty set would lock the admin out entirely).
    const adminPerms: Record<string, { enabled: boolean }> = {};
    for (const k of ['softphone', 'contacts', 'live', 'queues', 'campaigns', 'recordings', 'analytics', 'pbx', 'users', 'billing', 'team']) {
      adminPerms[k] = { enabled: true };
    }
    const role = await this.prisma.role.create({
      data: { tenantId: tenant.id, name: 'Administrator', isSystem: true, permissions: adminPerms },
    });
    await this.prisma.account.create({
      data: {
        tenantId: tenant.id, email,
        passwordHash: await AuthService.hash(dto.password),
        firstName: dto.firstName?.trim() || 'Admin',
        lastName: dto.lastName?.trim() || null,
        roleId: role.id, active: true,
      },
    });
    if (planId) await this.setPlan(tenant.id, planId);
    await ensureSystemDispositions(this.prisma, tenant.id);
    await this.provisionTrunk({ id: tenant.id, name: tenant.name, slug }, email);
    return { tenant: { id: tenant.id, name: tenant.name, slug }, email };
  }

  /** Active plans, safe to expose publicly so the signup page can show options. */
  publicPlans() {
    return this.prisma.plan.findMany({
      where: { active: true },
      orderBy: { priceMonthly: 'asc' },
      select: { id: true, name: true, priceMonthly: true, currency: true, features: true, limits: true },
    });
  }

  async setStatus(tenantId: string, status: 'active' | 'suspended') {
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { status, active: status === 'active' } });
    // Mirror the status to the carrier so a suspended tenant cannot place calls.
    // Best-effort: never let a carrier hiccup block the status change.
    const trunks = await this.prisma.trunk.findMany({
      where: { tenantId, provider: 'voipswitch', providerClientId: { not: null } },
    });
    for (const t of trunks) {
      try { await this.voipswitch.setActive(t.providerClientId!, status === 'active'); }
      catch (e: any) { this.logger.warn(`carrier status sync failed for client ${t.providerClientId}: ${e.message}`); }
    }
    return { tenantId, status };
  }

  async setPlan(tenantId: string, planId: string) {
    const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException('plan not found');
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { planId } });
    const periodEnd = new Date(); periodEnd.setMonth(periodEnd.getMonth() + 1);
    await this.prisma.subscription.create({ data: { tenantId, planId, status: 'active', periodEnd } });
    return { tenantId, plan: plan.name };
  }

  // ---------- plans ----------
  listPlans() { return this.prisma.plan.findMany({ orderBy: { priceMonthly: 'asc' } }); }
  createPlan(b: any) {
    return this.prisma.plan.create({ data: { name: b.name, priceMonthly: Number(b.priceMonthly) || 0, currency: b.currency ?? 'NGN', limits: b.limits ?? {}, features: b.features ?? [] } });
  }
  updatePlan(id: string, b: any) {
    return this.prisma.plan.update({ where: { id }, data: { name: b.name, priceMonthly: b.priceMonthly != null ? Number(b.priceMonthly) : undefined, currency: b.currency, limits: b.limits, features: b.features, active: b.active } });
  }

  // ---------- invoices ----------
  async generateInvoice(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, include: { plan: true } });
    if (!tenant) throw new NotFoundException('tenant not found');
    const usage = await this.usage(tenantId);
    const base = tenant.plan?.priceMonthly ?? 0;
    const lineItems = [
      { label: `${tenant.plan?.name ?? 'No plan'} (monthly)`, amount: base },
      { label: `Usage: ${usage.extensions} extensions, ${usage.callsThisPeriod} calls`, amount: 0 },
    ];
    const periodStart = new Date(); periodStart.setDate(1); periodStart.setHours(0, 0, 0, 0);
    const periodEnd = new Date(periodStart); periodEnd.setMonth(periodEnd.getMonth() + 1);
    return this.prisma.invoice.create({
      data: { tenantId, periodStart, periodEnd, amount: base, currency: tenant.plan?.currency ?? 'NGN', status: 'open', lineItems },
    });
  }

  listInvoices(tenantId: string) { return this.prisma.invoice.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } }); }

  async payInvoice(tenantId: string, invoiceId: string, email: string) {
    const inv = await this.prisma.invoice.findFirst({ where: { id: invoiceId, tenantId } });
    if (!inv) throw new NotFoundException('invoice not found');
    const provider = getPaymentProvider();
    const result = await provider.checkout({ amount: inv.amount, currency: inv.currency, email, reference: inv.id });
    await this.prisma.invoice.update({ where: { id: inv.id }, data: { provider: provider.name, providerRef: result.ref } });
    return { ...result, configured: provider.configured };
  }

  async markPaidById(invoiceId: string) {
    await this.prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'paid' } });
    return { invoiceId, status: 'paid' };
  }

  // ---------- branding ----------
  async branding(slug?: string) {
    const tenant = slug
      ? await this.prisma.tenant.findUnique({ where: { slug } })
      : (await this.prisma.tenant.findMany({ take: 2 })).length === 1
        ? (await this.prisma.tenant.findMany({ take: 1 }))[0]
        : null;
    const b: any = tenant?.branding ?? {};
    return { name: b.name ?? tenant?.name ?? 'nativetalk', logoUrl: b.logoUrl ?? null, color: b.color ?? '#16a34a' };
  }

  async setBranding(tenantId: string, branding: any) {
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { branding } });
    return branding;
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'tenant';
    let slug = base; let n = 1;
    while (await this.prisma.tenant.findUnique({ where: { slug } })) slug = `${base}-${++n}`;
    return slug;
  }
}
