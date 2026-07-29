import {
  Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, UseGuards, Module,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser, Permissions } from '../common/decorators';
import { RbacGuard, AuthUser } from '../common/rbac.guard';

// Generic JSON-backed store for contact-center collections whose relational
// models arrive in later phases. Tenant-scoped + whitelisted.
const ALLOWED = new Set([
  'outbound-campaigns', 'inbound-campaigns', 'blended-campaigns',
  'dispositions', 'dnc', 'webforms', 'lead-groups',
]);

function assertAllowed(name: string) {
  if (!ALLOWED.has(name)) throw new NotFoundException(`unknown collection "${name}"`);
}
const flatten = (r: any) => ({ id: r.id, createdAt: r.createdAt, updatedAt: r.updatedAt, ...(r.data as object) });

@UseGuards(RbacGuard)
@Permissions('campaigns')
@Controller('collections')
export class CollectionsController {
  constructor(private prisma: PrismaService) {}

  @Get(':collection')
  async list(@CurrentUser() u: AuthUser, @Param('collection') collection: string) {
    assertAllowed(collection);
    const rows = await this.prisma.dataRecord.findMany({
      where: { tenantId: u.tenantId, collection }, orderBy: { createdAt: 'asc' },
    });
    return rows.map(flatten);
  }

  @Post(':collection')
  async create(@CurrentUser() u: AuthUser, @Param('collection') collection: string, @Body() body: any) {
    assertAllowed(collection);
    const { id, createdAt, updatedAt, ...data } = body ?? {};
    const r = await this.prisma.dataRecord.create({ data: { tenantId: u.tenantId, collection, data } });
    return flatten(r);
  }

  @Patch(':collection/:id')
  async update(
    @CurrentUser() u: AuthUser,
    @Param('collection') collection: string,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    assertAllowed(collection);
    const existing = await this.prisma.dataRecord.findFirst({ where: { id, tenantId: u.tenantId, collection } });
    if (!existing) throw new NotFoundException('record not found');
    const { id: _i, createdAt, updatedAt, ...patch } = body ?? {};
    const merged = { ...(existing.data as object), ...patch };
    const r = await this.prisma.dataRecord.update({ where: { id }, data: { data: merged } });
    return flatten(r);
  }

  @Delete(':collection/:id')
  async remove(@CurrentUser() u: AuthUser, @Param('collection') collection: string, @Param('id') id: string) {
    assertAllowed(collection);
    const res = await this.prisma.dataRecord.deleteMany({ where: { id, tenantId: u.tenantId, collection } });
    return { deleted: res.count };
  }
}

@Module({ controllers: [CollectionsController] })
export class CollectionsModule {}
