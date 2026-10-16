import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/rbac.guard';

interface JwtPayload {
  sub: string;
  tenantId: string;
  email: string;
}

// Extract JWT from the httpOnly cookie. Falls back to Authorization header
// so tools like Postman/Swagger still work during development.
function cookieOrHeader(req: Request): string | null {
  if (req?.cookies?.nativetalk_token) return req.cookies.nativetalk_token;
  const auth = req?.headers?.authorization ?? '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([cookieOrHeader]),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET') ?? 'dev-secret',
      passReqToCallback: false,
    });
  }

  // Runs per request: loads fresh account + role so permission changes take
  // effect immediately without re-issuing the token.
  async validate(payload: JwtPayload): Promise<AuthUser> {
    const account = await this.prisma.account.findUnique({
      where: { id: payload.sub },
      include: { accountRole: true },
    });
    if (!account || !account.active) throw new UnauthorizedException('account disabled or missing');

    return {
      id: account.id,
      tenantId: account.tenantId,
      email: account.email,
      roleName: account.accountRole?.name ?? null,
      agentExtension: account.agentExtension ?? null,
      superAdmin: !!account.superAdmin,
      permissions: (account.accountRole?.permissions as AuthUser['permissions']) ?? {},
    };
  }
}
