import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { MetricsModule } from './metrics/metrics.module';

import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { FreeswitchModule } from './freeswitch/freeswitch.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './common/jwt-auth.guard';
import { RbacGuard } from './common/rbac.guard';

import { HealthModule } from './health/health.module';
import { RolesModule } from './roles/roles.module';
import { ResourcesModule } from './resources/resources.module';
import { CollectionsModule } from './collections/collections.module';
import { PbxModule } from './pbx/pbx.module';
import { TelephonyModule } from './telephony/telephony.module';
import { DialerModule } from './dialer/dialer.module';
import { RecordingsModule } from './recordings/recordings.module';
import { RealtimeModule } from './realtime/realtime.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { BillingModule } from './billing/billing.module';
import { ContactsModule } from './contacts/contacts.module';
import { CallLogsModule } from './call-logs/call-logs.module';
import { AccountsModule } from './accounts/accounts.module';
import { VoipswitchModule } from './voipswitch/voipswitch.service';
import { FsXmlModule } from './freeswitch-xml/fs-xml.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Global rate limit: 120 requests / minute / IP (login is stricter, see auth).
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]),
    MetricsModule,
    PrismaModule,
    RedisModule,
    FreeswitchModule,
    AuthModule,
    HealthModule,
    RolesModule,
    ResourcesModule,
    CollectionsModule,
    PbxModule,
    TelephonyModule,
    DialerModule,
    RecordingsModule,
    RealtimeModule,
    DashboardModule,
    BillingModule,
    ContactsModule,
    CallLogsModule,
    AccountsModule,
    VoipswitchModule,
    FsXmlModule,
  ],
  providers: [
    // Rate limit → authenticate → authorize (role/permission). Order matters.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
  ],
})
export class AppModule {}
