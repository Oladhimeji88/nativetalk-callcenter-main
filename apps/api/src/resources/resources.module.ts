import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards, Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { crud } from './crud';
import { CurrentUser, Permissions } from '../common/decorators';
import { RbacGuard, AuthUser } from '../common/rbac.guard';

// Four near-identical tenant-scoped CRUD resources. Each guards on its nav
// section/item permission so the RBAC policy actually gates access.

@UseGuards(RbacGuard)
@Permissions('users')
@Controller('users')
export class UsersController {
  private c = crud(this.prisma, 'user');
  constructor(private prisma: PrismaService) {}
  @Get() list(@CurrentUser() u: AuthUser) { return this.c.list(u); }
  @Post() create(@CurrentUser() u: AuthUser, @Body() b: any) { return this.c.create(u, b); }
  @Patch(':id') update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) { return this.c.update(u, id, b); }
  @Delete(':id') remove(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.c.remove(u, id); }
}

@UseGuards(RbacGuard)
@Permissions('users')
@Controller('user-roles')
export class UserRolesController {
  private c = crud(this.prisma, 'userRole');
  constructor(private prisma: PrismaService) {}
  @Get() list(@CurrentUser() u: AuthUser) { return this.c.list(u); }
  @Post() create(@CurrentUser() u: AuthUser, @Body() b: any) { return this.c.create(u, b); }
  @Patch(':id') update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) { return this.c.update(u, id, b); }
  @Delete(':id') remove(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.c.remove(u, id); }
}

@UseGuards(RbacGuard)
@Permissions('users')
@Controller('user-groups')
export class UserGroupsController {
  private c = crud(this.prisma, 'userGroup');
  constructor(private prisma: PrismaService) {}
  @Get() list(@CurrentUser() u: AuthUser) { return this.c.list(u); }
  @Post() create(@CurrentUser() u: AuthUser, @Body() b: any) { return this.c.create(u, b); }
  @Patch(':id') update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) { return this.c.update(u, id, b); }
  @Delete(':id') remove(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.c.remove(u, id); }
}

@UseGuards(RbacGuard)
@Permissions('pbx')
@Controller('outgoing-rules')
export class OutgoingRulesController {
  private c = crud(this.prisma, 'outgoingRule');
  constructor(private prisma: PrismaService) {}
  @Get() list(@CurrentUser() u: AuthUser) { return this.c.list(u); }
  @Post() create(@CurrentUser() u: AuthUser, @Body() b: any) { return this.c.create(u, b); }
  @Patch(':id') update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) { return this.c.update(u, id, b); }
  @Delete(':id') remove(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.c.remove(u, id); }
}

@Module({
  controllers: [UsersController, UserRolesController, UserGroupsController, OutgoingRulesController],
})
export class ResourcesModule {}
