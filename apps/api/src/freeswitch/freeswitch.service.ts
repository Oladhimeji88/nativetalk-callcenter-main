import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// esl is CommonJS; import the client constructor.
import { FreeSwitchClient } from 'esl';

/**
 * Persistent FreeSWITCH Event Socket connection.
 *
 * Unlike the legacy app (which opened a fresh socket per call), this keeps ONE
 * long-lived, auto-reconnecting connection — the foundation for realtime events
 * and for scaling the dialer. Commands degrade gracefully when FreeSWITCH is
 * down (callers get a clear error instead of a hang).
 */
@Injectable()
export class FreeswitchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FreeswitchService.name);
  private client: any;
  private fs: any = null; // live FreeSwitchResponse when connected
  private connected = false;
  // Consumers (the dialer) register here to receive mod_callcenter events.
  private callcenterHandlers: Array<(ev: Record<string, string>) => void> = [];

  /** Register a handler for mod_callcenter `callcenter::info` events (bridge /
   *  member-queue transitions). Called by the dialer to track bridged/abandoned. */
  onCallcenterEvent(cb: (ev: Record<string, string>) => void): void {
    this.callcenterHandlers.push(cb);
  }

  private dispatchCallcenter(ev: any): void {
    // event_json delivers the event fields as a StringMap in `body`.
    const b: Record<string, string> = (ev?.body && typeof ev.body === 'object') ? ev.body : (ev?.headers ?? {});
    if ((b['Event-Subclass'] || '') !== 'callcenter::info') return;
    for (const cb of this.callcenterHandlers) {
      try { cb(b); } catch { /* a bad handler must not break the socket */ }
    }
  }

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const host = this.config.get<string>('FS_HOST') ?? '127.0.0.1';
    const port = Number(this.config.get<string>('FS_PORT') ?? 8021);
    const password = this.config.get<string>('FS_PASSWORD') ?? 'ClueCon';
    const silent = { debug() {}, info() {}, warning() {}, error() {} };

    this.client = new FreeSwitchClient({ host, port, password, logger: silent });
    this.client.on('connect', (fs: any) => {
      this.fs = fs;
      this.connected = true;
      this.logger.log(`connected to FreeSWITCH at ${host}:${port}`);
      void Promise.resolve(this.ensureModules()).catch((e: any) =>
        this.logger.warn(`ensureModules failed: ${e?.message ?? e}`));
      // Subscribe to mod_callcenter events on this (fresh) connection so the dialer
      // can count bridged vs abandoned calls. Targeted subclass = low noise.
      // `fs.send` returns a promise that REJECTS on a dropped socket; a bare call
      // would surface as an unhandledRejection and crash the process on any ESL
      // blip (the tunnel is known to flap), so the rejection must be caught async.
      try {
        fs.on('CUSTOM', (ev: any) => this.dispatchCallcenter(ev));
        Promise.resolve(fs.send('event json CUSTOM callcenter::info')).catch((e: any) =>
          this.logger.warn(`callcenter subscribe failed: ${e?.message ?? e}`));
      } catch (e) {
        this.logger.warn(`could not subscribe to callcenter events: ${(e as Error).message}`);
      }
    });
    this.client.on('error', () => { this.connected = false; this.fs = null; });
    this.client.on('reconnecting', () => { this.connected = false; this.fs = null; });
    this.client.on('end', () => { this.connected = false; this.fs = null; });
    try {
      this.client.connect();
    } catch (e) {
      this.logger.warn(`FreeSWITCH not reachable at startup: ${(e as Error).message}`);
    }
  }

  async onModuleDestroy() {
    try { await this.client?.end(); } catch { /* ignore */ }
  }

  isConnected(): boolean {
    return this.connected && !!this.fs;
  }

  /**
   * Ensure the modules the platform depends on are loaded (mod_callcenter for
   * ACD queues, mod_avmd for answer-machine detection). They aren't in the
   * default autoload set on every build, so we load them on connect — idempotent
   * and survives FreeSWITCH restarts as long as the API reconnects.
   */
  private async ensureModules(): Promise<void> {
    const required = (this.config.get<string>('FS_REQUIRED_MODULES') ?? 'mod_callcenter,mod_avmd')
      .split(',').map((m) => m.trim()).filter(Boolean);
    for (const mod of required) {
      try {
        const exists = await this.api(`module_exists ${mod}`);
        if (exists !== 'true') {
          const r = await this.api(`load ${mod}`);
          this.logger.log(`loaded ${mod}: ${r.split('\n').pop()}`);
        }
      } catch (e) {
        this.logger.warn(`could not ensure ${mod}: ${(e as Error).message}`);
      }
    }
  }

  /** Run a blocking `api` command. Throws a clear error if FreeSWITCH is down. */
  async api(command: string): Promise<string> {
    if (!this.isConnected()) throw new Error('FreeSWITCH is not connected');
    try {
      const res = await this.fs.api(command);
      return (res?.body ?? '').trim();
    } catch (err: any) {
      // esl rejects failed commands with a FreeSwitchError carrying the -ERR reply.
      const body = (err?.res?.body ?? err?.message ?? '').trim();
      if (body) return body;
      throw err;
    }
  }

  /** Run a non-blocking `bgapi` command; returns the Job-UUID when available. */
  async bgapi(command: string): Promise<string | null> {
    if (!this.isConnected()) throw new Error('FreeSWITCH is not connected');
    const res = await this.fs.bgapi(command);
    return res?.headers?.['Job-UUID'] ?? res?.body ?? null;
  }

  /** Lightweight health probe used by /health. */
  async status(): Promise<{ connected: boolean; detail?: string }> {
    if (!this.isConnected()) return { connected: false };
    try {
      const body = await this.api('status');
      return { connected: true, detail: body.split('\n')[0] };
    } catch (e) {
      return { connected: false, detail: (e as Error).message };
    }
  }
}
