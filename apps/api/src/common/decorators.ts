import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

// Mark a route as public (skips JWT auth).
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

// Require one or more permissions (ALL must be held). Format: "section" or
// "section:item". This is the primary gate — it applies to every role equally.
export const PERMISSIONS_KEY = 'permissions';
export const Permissions = (...perms: string[]) => SetMetadata(PERMISSIONS_KEY, perms);

// Allow ANY authenticated user (regardless of role/permissions). For routes that
// only read the caller's own context — /auth/me, dispositions list, call logs.
export const ALLOW_AUTH_KEY = 'allowAuth';
export const AllowAuthenticated = () => SetMetadata(ALLOW_AUTH_KEY, true);

// Inject the authenticated manager (set by JwtStrategy.validate).
export const CurrentUser = createParamDecorator((data: string | undefined, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest();
  return data ? req.user?.[data] : req.user;
});
