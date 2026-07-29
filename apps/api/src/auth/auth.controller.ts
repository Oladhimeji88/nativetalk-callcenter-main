import { Body, Controller, Get, Post, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { CurrentUser, Public, AllowAuthenticated } from '../common/decorators';
import { AuthUser } from '../common/rbac.guard';

const COOKIE_NAME = 'nativetalk_token';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 8 } })
  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto.email, dto.password);
    const isProd = this.config.get('NODE_ENV') === 'production';
    res.cookie(COOKIE_NAME, result.accessToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'strict' : 'lax',
      // rememberMe: 30 days; otherwise session cookie (no maxAge = expires on browser close)
      ...(dto.rememberMe ? { maxAge: 30 * 24 * 60 * 60 * 1000 } : {}),
      path: '/',
    });
    // Return user profile only — the token is in the cookie, not the body.
    return { user: result.user };
  }

  @AllowAuthenticated()
  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(COOKIE_NAME, { path: '/' });
    return { ok: true };
  }

  // Every authenticated user can read their own profile — it's how the client
  // refreshes its cached role/permissions.
  @AllowAuthenticated()
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }
}
