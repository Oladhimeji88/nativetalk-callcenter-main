import { Controller, Get, Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { FreeswitchService } from '../freeswitch/freeswitch.service';
import { Public } from '../common/decorators';

@Controller('health')
export class HealthController {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private fs: FreeswitchService,
  ) {}

  @Public()
  @Get()
  async check() {
    const [db, redis, fs] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      this.redis.ping(),
      this.fs.status(),
    ]);
    const ok = db; // DB is the only hard dependency for the API to be "up"
    return {
      status: ok ? 'ok' : 'degraded',
      time: new Date().toISOString(),
      services: { database: db, redis, freeswitch: fs },
    };
  }

  // Liveness: is the process up? (no dependencies) — for container/orchestrator.
  @Public()
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  // Readiness: can we serve traffic? (DB must be reachable)
  @Public()
  @Get('ready')
  async ready() {
    const db = await this.prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
    return { status: db ? 'ready' : 'not-ready', database: db };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
