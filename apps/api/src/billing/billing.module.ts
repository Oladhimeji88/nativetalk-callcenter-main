import { Body, Controller, Get, Module, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, Public, Permissions } from '../common/decorators';
import { AuthUser } from '../common/rbac.guard';
import { SuperAdminGuard } from '../common/super-admin.guard';
import { BillingService } from './billing.service';
import { PbxModule } from '../pbx/pbx.module';

// Platform operator (super-admin): manage tenants and plans across the SaaS.
@UseGuards(SuperAdminGuard)
@Controller('platform')
export class PlatformController {
  constructor(private svc: BillingService) {}

  @Get('tenants') tenants() { return this.svc.listTenants(); }
  @Post('tenants') onboard(@Body() b: any) { return this.svc.onboardTenant(b); }
  @Post('tenants/:id/suspend') suspend(@Param('id') id: string) { return this.svc.setStatus(id, 'suspended'); }
  @Post('tenants/:id/activate') activate(@Param('id') id: string) { return this.svc.setStatus(id, 'active'); }
  @Post('tenants/:id/plan') setPlan(@Param('id') id: string, @Body() b: { planId: string }) { return this.svc.setPlan(id, b.planId); }
  @Get('tenants/:id/usage') usage(@Param('id') id: string) { return this.svc.usage(id); }
  @Post('tenants/:id/invoice') invoice(@Param('id') id: string) { return this.svc.generateInvoice(id); }
  @Post('invoices/:id/paid') markPaid(@Param('id') id: string) { return this.svc.markPaidById(id); }

  @Get('plans') plans() { return this.svc.listPlans(); }
  @Post('plans') createPlan(@Body() b: any) { return this.svc.createPlan(b); }
  @Patch('plans/:id') updatePlan(@Param('id') id: string, @Body() b: any) { return this.svc.updatePlan(id, b); }
}

// Tenant-side billing — requires the `billing` permission.
@Permissions('billing')
@Controller('billing')
export class BillingController {
  constructor(private svc: BillingService) {}

  @Get('me') me(@CurrentUser() u: AuthUser) { return this.svc.me(u.tenantId); }
  @Get('invoices') invoices(@CurrentUser() u: AuthUser) { return this.svc.listInvoices(u.tenantId); }
  @Post('invoices/:id/pay') pay(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.payInvoice(u.tenantId, id, u.email); }
  @Post('branding') branding(@CurrentUser() u: AuthUser, @Body() b: any) { return this.svc.setBranding(u.tenantId, b); }
}

// Public branding (so the login page can theme before auth).
@Public()
@Controller('branding')
export class BrandingController {
  constructor(private svc: BillingService) {}
  @Get() get(@Query('slug') slug?: string) { return this.svc.branding(slug); }
}

// Public self-service signup (no auth). New companies create a trial tenant +
// their first admin here, then log in normally.
@Public()
@Controller('signup')
export class SignupController {
  constructor(private svc: BillingService) {}

  // List the plans a prospect can pick at signup.
  @Get('plans') plans() { return this.svc.publicPlans(); }

  // Abuse guard: max 5 signups per minute per IP.
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post() register(@Body() b: any) { return this.svc.registerTenant(b); }
}

@Module({
  imports: [PbxModule],
  controllers: [PlatformController, BillingController, BrandingController, SignupController],
  providers: [BillingService],
})
export class BillingModule {}
