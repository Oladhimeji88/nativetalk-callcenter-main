import { Body, Controller, ForbiddenException, Get, Module, Param, Patch, Post, Query, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { PbxModule } from '../pbx/pbx.module';
import { PbxService } from '../pbx/pbx.service';
import { CurrentUser, Permissions } from '../common/decorators';
import { AuthUser } from '../common/rbac.guard';
import { isTeamScoped, teamScopeIds } from '../common/team-scope';


function genExtPassword(): string {
  return 'Ag-' + Math.random().toString(36).slice(2, 8) + '!' + Math.floor(Math.random() * 90 + 10);
}

// Account management within a company. Every account owns a SIP extension
// (number + password) which is its softphone identity — created inline here and
// pushed to FreeSWITCH. Requires the 'users' permission (admins bypass).
@Permissions('users')
@Controller('accounts')
export class AccountsController {
  constructor(private prisma: PrismaService, private pbx: PbxService) {}

  @Get()
  async list(@CurrentUser() u: AuthUser, @Query('role') role?: string) {
    // Team-scoped managers only see themselves + everyone under them.
    const scope = await teamScopeIds(this.prisma, u);
    const rows = await this.prisma.account.findMany({
      where: {
        tenantId: u.tenantId,
        ...(role ? { role } : {}),
        ...(u.superAdmin ? {} : { superAdmin: false }),
        ...(scope ? { id: { in: scope } } : {}),
      },
      include: { accountRole: true },
      orderBy: { createdAt: 'asc' },
    });
    // Display name per account (to resolve each user's manager name).
    const nameById = new Map(rows.map((r) => [r.id, [r.firstName, r.lastName].filter(Boolean).join(' ') || r.email]));
    // Which campaigns each user is assigned to (reverse of assignedAgentIds).
    const campaigns = await this.prisma.outboundCampaign.findMany({
      where: { tenantId: u.tenantId }, select: { name: true, assignedAgentIds: true },
    });
    const campsByAgent = new Map<string, string[]>();
    for (const c of campaigns) for (const aid of c.assignedAgentIds || []) {
      const arr = campsByAgent.get(aid) || []; arr.push(c.name); campsByAgent.set(aid, arr);
    }
    return rows.map(({ passwordHash, ...m }) => ({
      ...m,
      roleName: m.accountRole?.name ?? null,
      managerName: m.managerId ? nameById.get(m.managerId) ?? null : null,
      campaigns: campsByAgent.get(m.id) ?? [],
      canManageTeam: this.canManageTeam(m),
    }));
  }

  /** Whether an account's role lets it manage a team (have users report to it):
   *  driven purely by the `team` permission. Super-admins always qualify. */
  private canManageTeam(acct: { superAdmin?: boolean; accountRole?: { permissions?: any } | null }): boolean {
    if (acct.superAdmin) return true;
    return !!(acct.accountRole?.permissions as any)?.team?.enabled;
  }

  /** Validate a manager choice: must be a user whose role can manage a team, in
   *  the same tenant, not the user themselves. Empty/undefined clears the manager. */
  private async resolveManagerId(tenantId: string, managerId: any, selfId?: string): Promise<string | null> {
    if (!managerId) return null;
    if (selfId && managerId === selfId) throw new BadRequestException("a user can't be their own manager");
    const mgr = await this.prisma.account.findFirst({ where: { id: managerId, tenantId }, include: { accountRole: true } });
    if (!mgr) throw new BadRequestException('manager not found');
    if (!this.canManageTeam(mgr)) throw new BadRequestException("that user's role can't manage a team");
    return managerId;
  }

  // Next free extension number for the Add Account form hint.
  @Get('next-extension')
  async nextExtension(@CurrentUser() u: AuthUser) {
    const exts = await this.prisma.extension.findMany({ where: { tenantId: u.tenantId }, select: { extension: true } });
    const nums = exts.map((e) => parseInt(e.extension, 10)).filter((n) => !Number.isNaN(n));
    return { next: String((nums.length ? Math.max(...nums) : 1000) + 1) };
  }

  @Post()
  async create(@CurrentUser() u: AuthUser, @Body() b: any) {
    if (!b.email?.trim() || !b.password) throw new BadRequestException('email and password are required');
    const email = b.email.toLowerCase().trim();
    const exists = await this.prisma.account.findFirst({ where: { tenantId: u.tenantId, email } });
    if (exists) throw new BadRequestException('an account with that email already exists');

    // Validate the extension (every account gets one) before creating anything.
    const extNumber = String(b.extension ?? '').trim();
    if (!extNumber) throw new BadRequestException('an extension number is required');
    if (!/^\d{3,6}$/.test(extNumber)) throw new BadRequestException('extension must be 3–6 digits (e.g. 1006)');
    const extTaken = await this.prisma.extension.findFirst({ where: { tenantId: u.tenantId, extension: extNumber } });
    if (extTaken) throw new BadRequestException(`extension ${extNumber} is already in use`);

    // A team-scoped creator can only add people to their own team, so the new
    // user is placed directly under them regardless of what was requested.
    const managerId = isTeamScoped(u) ? u.id : await this.resolveManagerId(u.tenantId, b.managerId);
    const displayName = [b.firstName, b.lastName].filter(Boolean).join(' ') || email;
    const account = await this.prisma.account.create({
      data: {
        tenantId: u.tenantId,
        email,
        passwordHash: await AuthService.hash(b.password),
        firstName: b.firstName, lastName: b.lastName, username: b.username,
        agentExtension: extNumber,
        roleId: b.roleId ?? null,
        managerId,
      },
    });

    await this.prisma.extension.create({
      data: {
        tenantId: u.tenantId,
        extension: extNumber,
        password: b.extPassword?.trim() || genExtPassword(),
        displayName,
      },
    });
    this.pbx.safeSync(u.tenantId);

    return this.safe(account);
  }

  @Patch(':id')
  async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) {
    const target = await this.prisma.account.findFirst({ where: { id, tenantId: u.tenantId } });
    if (!target) throw new BadRequestException('account not found');

    // Team-scoped managers may only edit users within their own team.
    const scope = await teamScopeIds(this.prisma, u);
    if (scope && !scope.includes(id)) throw new ForbiddenException('you can only manage your own team');

    const data: any = {
      firstName: b.firstName, lastName: b.lastName, active: b.active, roleId: b.roleId,
    };
    if (b.managerId !== undefined) data.managerId = await this.resolveManagerId(u.tenantId, b.managerId, id);
    if (b.password) data.passwordHash = await AuthService.hash(b.password);

    // Handle extension changes: rename / reassign / reset password.
    const newExt = b.extension !== undefined ? String(b.extension).trim() : undefined;
    if (newExt !== undefined && newExt !== target.agentExtension) {
      if (!/^\d{3,6}$/.test(newExt)) throw new BadRequestException('extension must be 3–6 digits');
      const clash = await this.prisma.extension.findFirst({ where: { tenantId: u.tenantId, extension: newExt } });
      if (clash) throw new BadRequestException(`extension ${newExt} is already in use`);
      data.agentExtension = newExt;
      // Move the old extension record to the new number (or create one).
      const old = target.agentExtension
        ? await this.prisma.extension.findFirst({ where: { tenantId: u.tenantId, extension: target.agentExtension } })
        : null;
      if (old) await this.prisma.extension.update({ where: { id: old.id }, data: { extension: newExt } });
      else await this.prisma.extension.create({ data: { tenantId: u.tenantId, extension: newExt, password: genExtPassword(), displayName: [b.firstName ?? target.firstName, b.lastName ?? target.lastName].filter(Boolean).join(' ') || target.email } });
    }
    if (b.extPassword?.trim() && target.agentExtension) {
      await this.prisma.extension.updateMany({ where: { tenantId: u.tenantId, extension: data.agentExtension ?? target.agentExtension }, data: { password: b.extPassword.trim() } });
    }

    const updated = await this.prisma.account.update({ where: { id }, data });
    this.pbx.safeSync(u.tenantId);
    return this.safe(updated);
  }

  private safe(m: any) { const { passwordHash, ...rest } = m; return rest; }
}

@Module({ imports: [PbxModule], controllers: [AccountsController] })
export class AccountsModule {}
