import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

// Thin Redis wrapper for realtime state + (later) the BullMQ job queue.
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  public client: Redis;
  private ready = false;

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
    this.client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 2 });
    this.client.on('error', (e) => this.logger.warn(`redis error: ${e.message}`));
    this.client.on('ready', () => { this.ready = true; });
  }

  async onModuleInit() {
    try {
      await this.client.connect();
      this.logger.log('connected to Redis');
    } catch (e) {
      this.logger.warn(`Redis not reachable at startup: ${(e as Error).message}`);
    }
  }

  async onModuleDestroy() {
    try { await this.client.quit(); } catch { /* ignore */ }
  }

  async ping(): Promise<boolean> {
    try { return (await this.client.ping()) === 'PONG'; } catch { return false; }
  }
}
