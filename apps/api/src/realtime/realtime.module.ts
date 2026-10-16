import { Injectable, Logger, Module } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, WebSocketGateway, WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { FreeswitchService } from '../freeswitch/freeswitch.service';
import { DialerModule } from '../dialer/dialer.module';
import { DialerService } from '../dialer/dialer.service';

// Builds a live snapshot of the contact centre from FreeSWITCH + active runs.
@Injectable()
export class RealtimeService {
  constructor(private fs: FreeswitchService, private dialer: DialerService) {}

  private parseTable(body: string) {
    const lines = body.split('\n').filter((l) => l && !l.startsWith('+OK'));
    if (lines.length < 1) return [];
    const header = lines[0].split('|');
    return lines.slice(1).map((line) => {
      const cols = line.split('|');
      const row: Record<string, string> = {};
      header.forEach((h, i) => (row[h] = cols[i] ?? ''));
      return row;
    });
  }

  async snapshot(tenantId?: string) {
    const safe = async (cmd: string) => { try { return await this.fs.api(cmd); } catch { return ''; } };
    const [agentsRaw, queuesRaw, callsRaw] = await Promise.all([
      safe('callcenter_config agent list'),
      safe('callcenter_config queue list'),
      safe('show calls as json'),
    ]);
    let calls: any[] = [];
    try { calls = JSON.parse(callsRaw).rows ?? []; } catch { /* ignore */ }
    const agents = this.parseTable(agentsRaw).map((a) => ({
      name: a.name, status: a.status, state: a.state,
      callsAnswered: Number(a.calls_answered || 0), talkTime: Number(a.talk_time || 0),
    }));
    const queues = this.parseTable(queuesRaw).map((q) => ({
      name: q.name, strategy: q.strategy,
      answered: Number(q.calls_answered || 0), abandoned: Number(q.calls_abandoned || 0),
    }));
    return {
      at: new Date().toISOString(),
      agents,
      queues,
      activeCalls: calls.length,
      calls: calls.slice(0, 50),
      campaigns: this.dialer.listRuns(tenantId),
      summary: {
        agentsAvailable: agents.filter((a) => /Available/i.test(a.status) && /Waiting/i.test(a.state)).length,
        agentsOnCall: agents.filter((a) => /Active|InQueue|Receiving/i.test(a.state)).length,
        agentsOnBreak: agents.filter((a) => /Break/i.test(a.status)).length,
      },
    };
  }
}

// Pushes a snapshot to subscribed clients every 2s (only while clients connected).
@WebSocketGateway({ cors: { origin: true }, namespace: '/realtime' })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);
  @WebSocketServer() server!: Server;
  private timer: NodeJS.Timeout | null = null;
  private clients = 0;

  constructor(private svc: RealtimeService, private jwt: JwtService) {}

  afterInit() { this.logger.log('realtime gateway ready (/realtime)'); }

  async handleConnection(client: Socket) {
    // Validate the JWT passed in the handshake; disconnect if missing/invalid.
    const token = (client.handshake.auth?.token as string) || (client.handshake.query?.token as string);
    try {
      const payload: any = await this.jwt.verifyAsync(token);
      (client.data as any).tenantId = payload.tenantId;
    } catch {
      client.emit('error', 'unauthorized');
      client.disconnect(true);
      return;
    }
    this.clients++;
    void this.push();
    if (!this.timer) this.timer = setInterval(() => this.push(), 2000);
  }

  handleDisconnect() {
    this.clients = Math.max(0, this.clients - 1);
    if (this.clients === 0 && this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  private async push() {
    try {
      const snap = await this.svc.snapshot();
      this.server.emit('snapshot', snap);
    } catch (e) {
      this.logger.warn(`snapshot failed: ${(e as Error).message}`);
    }
  }
}

@Module({
  imports: [
    DialerModule,
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ secret: config.get<string>('JWT_SECRET') ?? 'dev-secret' }),
    }),
  ],
  providers: [RealtimeService, RealtimeGateway],
})
export class RealtimeModule {}
