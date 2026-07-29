import {
  Body, Controller, Delete, Get, Param, Patch, Post, UseGuards, Module, Type,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { crud } from '../resources/crud';
import { CurrentUser, Permissions } from '../common/decorators';
import { RbacGuard, AuthUser } from '../common/rbac.guard';
import { PbxService } from './pbx.service';
import { QueuesController } from './queues.controller';

// Factory returns a fully-decorated controller class (no inheritance, so NestJS
// DI metadata is emitted directly on the class it registers). Each PBX resource
// is tenant-scoped CRUD that re-syncs FreeSWITCH after every mutation, so the
// live phone system always matches the database.
function pbxController(routePath: string, model: string): Type<any> {
  @Controller(routePath)
  @UseGuards(RbacGuard)
  @Permissions('pbx')
  class ResourceController {
    private c = crud(this.prisma, model);
    constructor(public prisma: PrismaService, public pbx: PbxService) {}

    @Get() list(@CurrentUser() u: AuthUser) { return this.c.list(u); }

    @Post() async create(@CurrentUser() u: AuthUser, @Body() b: any) {
      const r = await this.c.create(u, b);
      await this.pbx.safeSync(u.tenantId);
      return r;
    }

    @Patch(':id') async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) {
      const r = await this.c.update(u, id, b);
      await this.pbx.safeSync(u.tenantId);
      return r;
    }

    @Delete(':id') async remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
      const r = await this.c.remove(u, id);
      await this.pbx.safeSync(u.tenantId);
      return r;
    }
  }
  return ResourceController;
}

const ExtensionsController = pbxController('pbx/extensions', 'extension');
const RingGroupsController = pbxController('pbx/ring-groups', 'ringGroup');
const InboundRoutesController = pbxController('pbx/inbound-routes', 'inboundRoute');
const IvrsController = pbxController('pbx/ivrs', 'ivr');
// Queues have a dedicated controller (QueuesController) — supervisor-gated,
// auto-numbered, and decorated with live ACD stats. See ./queues.controller.
const TimeConditionsController = pbxController('pbx/time-conditions', 'timeCondition');

// Trunks get a dedicated controller because a Sofia gateway name must be UNIQUE
// across the whole FreeSWITCH box (not just per-tenant). We namespace the name
// with the tenant slug on create so two tenants can't collide; the name is the
// gateway's identity so it's immutable afterwards.
@Controller('pbx/trunks')
@UseGuards(RbacGuard)
@Permissions('pbx')
export class TrunksController {
  private c = crud(this.prisma, 'trunk');
  constructor(public prisma: PrismaService, public pbx: PbxService) {}

  @Get() list(@CurrentUser() u: AuthUser) { return this.c.list(u); }

  @Post() async create(@CurrentUser() u: AuthUser, @Body() b: any) {
    b.name = await this.gatewayName(u.tenantId, b?.name);
    const r = await this.c.create(u, b);
    await this.pbx.safeSync(u.tenantId);
    return r;
  }

  @Patch(':id') async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) {
    const { name, ...rest } = b ?? {}; // gateway name is immutable after creation
    const r = await this.c.update(u, id, rest);
    await this.pbx.safeSync(u.tenantId);
    return r;
  }

  @Delete(':id') async remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const r = await this.c.remove(u, id);
    await this.pbx.safeSync(u.tenantId);
    return r;
  }

  /** Globally-unique Sofia gateway name = <tenant-slug>_<sanitised label>. */
  private async gatewayName(tenantId: string, raw: string): Promise<string> {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } });
    const slug = (t?.slug || tenantId.slice(0, 8)).toLowerCase().replace(/[^a-z0-9]+/g, '');
    const base = String(raw || 'trunk').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'trunk';
    const prefix = `${slug}_`;
    return (base.startsWith(prefix) ? base : prefix + base).slice(0, 64);
  }
}

// Apply / preview the whole tenant config.
@UseGuards(RbacGuard)
@Permissions('pbx')
@Controller('pbx')
export class PbxController {
  constructor(private pbx: PbxService) {}
  @Post('sync') sync(@CurrentUser() u: AuthUser) { return this.pbx.sync(u.tenantId); }
  @Get('preview') preview(@CurrentUser() u: AuthUser) { return this.pbx.preview(u.tenantId); }
}

@Module({
  controllers: [
    ExtensionsController, TrunksController, RingGroupsController, InboundRoutesController,
    IvrsController, QueuesController, TimeConditionsController, PbxController,
  ],
  providers: [PbxService],
  exports: [PbxService],
})
export class PbxModule {}
