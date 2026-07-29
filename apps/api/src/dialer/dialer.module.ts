import {
  Body, Controller, Delete, Get, Module, Param, Patch, Post, UseGuards, Type, BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { crud } from '../resources/crud';
import { CurrentUser, Permissions, AllowAuthenticated } from '../common/decorators';
import { RbacGuard, AuthUser } from '../common/rbac.guard';
import { DialerService } from './dialer.service';
import { CampaignPreviewController } from './campaign-preview.controller';

// Tenant-scoped CRUD for a contact-center resource, guarded by 'contact-center'.
function ccController(routePath: string, model: string): Type<any> {
  @Controller(routePath)
  @UseGuards(RbacGuard)
  @Permissions('campaigns')
  class ResourceController {
    private c = crud(this.prisma, model);
    constructor(public prisma: PrismaService) {}
    @Get() list(@CurrentUser() u: AuthUser) { return this.c.list(u); }
    @Post() create(@CurrentUser() u: AuthUser, @Body() b: any) { return this.c.create(u, b); }
    @Patch(':id') update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) { return this.c.update(u, id, b); }
    @Delete(':id') remove(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.c.remove(u, id); }
  }
  return ResourceController;
}

// Campaigns: standard tenant CRUD, but update routes through DialerService so a
// change to the targeting fields invalidates stale materialised leads.
@Controller('campaigns')
@UseGuards(RbacGuard)
@Permissions('campaigns')
class CampaignsCrud {
  private c = crud(this.prisma, 'outboundCampaign');
  constructor(public prisma: PrismaService, private dialer: DialerService) {}
  @Get() list(@CurrentUser() u: AuthUser) { return this.c.list(u); }
  @Post() create(@CurrentUser() u: AuthUser, @Body() b: any) { return this.c.create(u, b); }
  @Patch(':id') update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) {
    return this.dialer.updateCampaign(u.tenantId, id, b);
  }
  @Delete(':id') remove(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.c.remove(u, id); }
}
const DncController = ccController('dnc', 'dnc');

// Dispositions: agents need to READ the list during call wrap-up, but only
// contact-center managers may create/edit/delete.
@Controller('dispositions')
@UseGuards(RbacGuard)
class DispositionsController {
  private c = crud(this.prisma, 'disposition');
  constructor(public prisma: PrismaService) {}
  @AllowAuthenticated() @Get() list(@CurrentUser() u: AuthUser) { return this.c.list(u); }
  @Permissions('campaigns') @Post() create(@CurrentUser() u: AuthUser, @Body() b: any) { return this.c.create(u, b); }
  @Permissions('campaigns') @Patch(':id') async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) {
    // System dispositions are read-only (their names/categories are what the
    // dialer's auto-labels rely on).
    const d = await this.prisma.disposition.findFirst({ where: { id, tenantId: u.tenantId } });
    if (d?.isSystem) throw new BadRequestException('This is a standard disposition and cannot be edited.');
    return this.c.update(u, id, b);
  }
  @Permissions('campaigns') @Delete(':id') async remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const d = await this.prisma.disposition.findFirst({ where: { id, tenantId: u.tenantId } });
    if (d?.isSystem) throw new BadRequestException('This is a standard disposition and cannot be deleted.');
    return this.c.remove(u, id);
  }
}
const LeadGroupsController = ccController('lead-groups', 'leadGroup');
const LeadsController = ccController('leads', 'lead');

// Dialer run controls for supervisors: monitor + force-stop + disposition.
// Dialing itself is agent-driven (agents join/leave the campaign queue); there
// is no admin blast-start.
@UseGuards(RbacGuard)
@Permissions('campaigns')
@Controller('campaigns')
export class DialerController {
  constructor(private dialer: DialerService) {}

  @Post(':id/stop')
  stop(@Param('id') id: string) {
    return this.dialer.stop(id);
  }

  @Get(':id/run')
  run(@Param('id') id: string) {
    // null (not 404) when no agent has played in yet — the Monitor polls this
    // continuously and a missing run is an expected "waiting" state, not an error.
    return this.dialer.getRun(id);
  }

  @Get('overview')
  overview(@CurrentUser() u: AuthUser) {
    return this.dialer.campaignsOverview(u.tenantId);
  }

  // Diagnostic: recent dialer lifecycle trace (join/tier/dial/drain/unwire).
  @Get('_trace')
  trace() {
    return { trace: this.dialer.getTrace(400) };
  }

  @Get('_trace/clear')
  clearTrace() {
    this.dialer.clearTrace();
    return { ok: true };
  }

  @Get(':id/leads')
  leads(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.dialer.campaignLeads(u.tenantId, id);
  }

  @Get(':id/calls')
  calls(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.dialer.campaignCalls(u.tenantId, id);
  }

  @Get(':id/runs')
  runs(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.dialer.campaignRuns(u.tenantId, id);
  }

  @Get(':id/runs/:runId/calls')
  runCalls(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('runId') runId: string) {
    return this.dialer.campaignRunCalls(u.tenantId, id, runId);
  }

  @Post(':id/duplicate')
  duplicate(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.dialer.duplicateCampaign(u.tenantId, id);
  }

  @Post(':id/reset')
  reset(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.dialer.resetCampaignProgress(u.tenantId, id);
  }

  @Post(':id/disposition')
  dispo(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: { number?: string; disposition?: string }) {
    return this.dialer.setDisposition(u.tenantId, id, b?.number ?? '', b?.disposition ?? '');
  }
}

// Reports over the persisted CallAttempt data.
@UseGuards(RbacGuard)
@Permissions('analytics')
@Controller('reports')
export class ReportsController {
  constructor(private dialer: DialerService) {}
  @Get('campaign') campaign(@CurrentUser() u: AuthUser) { return this.dialer.campaignReport(u.tenantId); }
  @Get('cdr') cdr(@CurrentUser() u: AuthUser) { return this.dialer.cdr(u.tenantId); }
  @Get('agent-performance') agentPerf(@CurrentUser() u: AuthUser) { return this.dialer.agentPerformance(u.tenantId); }
}

@Module({
  controllers: [
    CampaignsCrud, DispositionsController, DncController, LeadGroupsController, LeadsController,
    DialerController, ReportsController, CampaignPreviewController,
  ],
  providers: [DialerService],
  exports: [DialerService],
})
export class DialerModule {}
