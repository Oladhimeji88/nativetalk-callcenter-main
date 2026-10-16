import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthUser } from './rbac.guard';

// Allows only platform operators (Manager.superAdmin). Used for cross-tenant
// (platform) endpoints like tenant onboarding and plan management.
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const user: AuthUser | undefined = ctx.switchToHttp().getRequest().user;
    if (!user?.superAdmin) throw new ForbiddenException('super-admin only');
    return true;
  }
}
