import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async login(email: string, password: string) {
    const account = await this.prisma.account.findFirst({
      where: { email: email.toLowerCase().trim() },
      include: { accountRole: true, tenant: true },
    });
    if (!account || !account.active) throw new UnauthorizedException('invalid credentials');

    const ok = await bcrypt.compare(password, account.passwordHash);
    if (!ok) throw new UnauthorizedException('invalid credentials');

    await this.prisma.account.update({ where: { id: account.id }, data: { lastLoginAt: new Date() } });
    await this.prisma.auditLog.create({
      data: { tenantId: account.tenantId, actorId: account.id, actorEmail: account.email, action: 'login' },
    });

    const token = await this.jwt.signAsync({
      sub: account.id,
      tenantId: account.tenantId,
      email: account.email,
    });

    return {
      accessToken: token,
      user: {
        id: account.id,
        email: account.email,
        firstName: account.firstName,
        lastName: account.lastName,
        tenantId: account.tenantId,
        tenant: account.tenant?.name,
        roleName: account.accountRole?.name ?? null,
        agentExtension: account.agentExtension ?? null,
        superAdmin: !!account.superAdmin,
        permissions: account.accountRole?.permissions ?? {},
      },
    };
  }

  static async hash(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }
}
