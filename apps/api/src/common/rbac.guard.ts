import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY, ALLOW_AUTH_KEY, IS_PUBLIC_KEY } from './decorators';

export interface AuthUser {
  id: string;
  tenantId: string;
  email: string;
  roleName?: string | null; // the account's role (permission group), e.g. "Supervisor" / "test"
  agentExtension?: string | null;
  superAdmin: boolean; // platform operator (cross-tenant); the only access shortcut
  permissions: Record<string, { enabled?: boolean; items?: Record<string, boolean> }>;
}

/**
 * Global access control (runs after JwtAuthGuard on every route). Permission-first
 * — there is no role tier; a role is just a group of permissions.
 *  - @Public()            → skip all checks (login, signup, health)
 *  - superAdmin           → full access (platform operator, cross-tenant)
 *  - @AllowAuthenticated() → any signed-in user (own-context reads: /auth/me, …)
 *  - @Permissions('x')    → the caller's role must grant permission x (same for
 *                           every role; "admin" is just the role with all of them)
 *  - anything else        → denied
 */
@Injectable()
export class RbacGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const user: AuthUser | undefined = context.switchToHttp().getRequest().user;
    if (!user) throw new ForbiddenException('not authenticated');

    // Platform operator (cross-tenant) is the only blanket bypass.
    if (user.superAdmin) return true;

    // Any authenticated user may reach @AllowAuthenticated routes (own-context reads).
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_AUTH_KEY, targets)) return true;

    // Everything else is gated by permission — the same for every role. A role is
    // just a group of permissions; "admin" is simply the group with all of them on.
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, targets);
    if (required && required.length > 0 && required.every((perm) => this.has(user, perm))) return true;

    throw new ForbiddenException('insufficient permissions');
  }

  private has(user: AuthUser, perm: string): boolean {
    const [section, item] = perm.split(':');
    const sec = user.permissions?.[section];
    if (!sec) return false;
    if (item) return !!sec.items?.[item];
    return !!sec.enabled;
  }
}
