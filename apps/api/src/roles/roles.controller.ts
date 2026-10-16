import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser, Permissions } from '../common/decorators';
import { AuthUser } from '../common/rbac.guard';
import { resolvePermissionDeps } from '../common/permission-deps';

@Permissions('users')
@Controller('roles')
export class RolesController {
  constructor(private prisma: PrismaService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.prisma.role.findMany({ where: { tenantId: u.tenantId }, orderBy: { name: 'asc' } });
  }

  // Reject duplicate role names within a tenant with a clear message
  // (the DB also enforces this via a unique constraint).
  private async assertNameFree(tenantId: string, name: string, exceptId?: string) {
    const clash = await this.prisma.role.findFirst({ where: { tenantId, name } });
    if (clash && clash.id !== exceptId) {
      throw new BadRequestException(`A role named "${name}" already exists. Choose a different name.`);
    }
  }

  // Pick a unique "(copy)" name so cloning never collides.
  private async uniqueCopyName(tenantId: string, base: string): Promise<string> {
    let name = `${base} (copy)`;
    for (let n = 2; await this.prisma.role.findFirst({ where: { tenantId, name } }); n++) {
      name = `${base} (copy ${n})`;
    }
    return name;
  }

  @Post()
  async create(@CurrentUser() u: AuthUser, @Body() body: any) {
    const name = String(body.name ?? '').trim() || 'Untitled';
    await this.assertNameFree(u.tenantId, name);
    return this.prisma.role.create({
      data: { tenantId: u.tenantId, name, isSystem: false, permissions: resolvePermissionDeps(body.permissions), active: body.active !== false },
    });
  }

  // Clone an existing role (including system roles) into a new custom role.
  @Post(':id/clone')
  async clone(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: any) {
    const source = await this.prisma.role.findFirst({ where: { id, tenantId: u.tenantId } });
    if (!source) throw new BadRequestException('role not found');
    const name = body.name ? String(body.name).trim() : await this.uniqueCopyName(u.tenantId, source.name);
    await this.assertNameFree(u.tenantId, name);
    return this.prisma.role.create({
      data: { tenantId: u.tenantId, name, isSystem: false, permissions: resolvePermissionDeps(source.permissions), active: true },
    });
  }

  @Patch(':id')
  async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: any) {
    const role = await this.prisma.role.findFirst({ where: { id, tenantId: u.tenantId } });
    if (!role) throw new BadRequestException('role not found');
    if (role.isSystem) throw new BadRequestException('system roles cannot be edited — clone it to create a custom role');
    if (body.name !== undefined) await this.assertNameFree(u.tenantId, String(body.name).trim(), id);
    return this.prisma.role.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: String(body.name).trim() } : {}),
        ...(body.permissions !== undefined ? { permissions: resolvePermissionDeps(body.permissions) } : {}),
        ...(body.active !== undefined ? { active: !!body.active } : {}),
      },
    });
  }

  @Delete(':id')
  async remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const role = await this.prisma.role.findFirst({ where: { id, tenantId: u.tenantId } });
    if (!role) throw new BadRequestException('role not found');
    if (role.isSystem) throw new BadRequestException('system roles cannot be deleted — clone it to create a custom role');
    return this.prisma.role.delete({ where: { id } });
  }
}
