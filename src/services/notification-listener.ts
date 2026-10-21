import type { FastifyBaseLogger } from 'fastify';
import pg from 'pg';
import type { RealtimeHub } from '../realtime/hub.js';

export class NotificationListener {
  private client: pg.Client | undefined;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private connecting = false;
  private heartbeatRunning = false;
  private stopped = false;
  private lastSuccessAtMs = 0;
  private lastErrorAtMs = 0;

  public constructor(
    private readonly databaseUrl: string,
    private readonly hub: RealtimeHub,
    private readonly logger: FastifyBaseLogger,
    private readonly heartbeatIntervalMs: number,
    private readonly maxStaleMs: number,
  ) {}

  public async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
    if (this.heartbeatTimer === undefined) {
      this.heartbeatTimer = setInterval(() => void this.heartbeat(), this.heartbeatIntervalMs);
      this.heartbeatTimer.unref();
    }
  }

  public async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer !== undefined) clearInterval(this.heartbeatTimer);
    this.reconnectTimer = undefined;
    this.heartbeatTimer = undefined;
    const client = this.client;
    this.client = undefined;
    if (client !== undefined) await client.end().catch(() => undefined);
  }

  public health(): {
    ready: boolean;
    reconnectScheduled: boolean;
    lastSuccessAt?: string;
    lastErrorAt?: string;
  } {
    const ready =
      this.client !== undefined &&
      !this.stopped &&
      this.lastSuccessAtMs > 0 &&
      Date.now() - this.lastSuccessAtMs <= this.maxStaleMs;
    return {
      ready,
      reconnectScheduled: this.reconnectTimer !== undefined,
      ...(this.lastSuccessAtMs === 0
        ? {}
        : { lastSuccessAt: new Date(this.lastSuccessAtMs).toISOString() }),
      ...(this.lastErrorAtMs === 0
        ? {}
        : { lastErrorAt: new Date(this.lastErrorAtMs).toISOString() }),
    };
  }

  private async connect(): Promise<void> {
    if (this.connecting || this.stopped) return;
    this.connecting = true;
    const client = new pg.Client({
      connectionString: this.databaseUrl,
      application_name: 'atas-realtime-listener',
    });

    try {
      client.on('notification', (message) => {
        if (message.channel !== 'atas_realtime' || message.payload === undefined) return;
        this.lastSuccessAtMs = Date.now();
        try {
          const parsed = JSON.parse(message.payload) as {
            changeId: number;
            matchId?: string;
            type: string;
            payload?: Record<string, unknown>;
            payloadOmitted?: boolean;
            createdAt: string;
          };
          if (parsed.matchId !== undefined) this.hub.publish(parsed.matchId, parsed);
        } catch (error) {
          this.logger.error({ err: error }, 'Invalid realtime notification');
        }
      });

      client.on('error', (error) => {
        if (this.client === client) this.client = undefined;
        this.lastErrorAtMs = Date.now();
        this.logger.error({ err: error }, 'Realtime listener connection failed');
        this.scheduleReconnect();
      });
      client.on('end', () => {
        if (this.client === client) this.client = undefined;
        if (!this.stopped) {
          this.lastErrorAtMs = Date.now();
          this.logger.warn('Realtime listener connection ended');
          this.scheduleReconnect();
        }
      });

      await client.connect();
      await client.query('LISTEN atas_realtime');
      await client.query('SELECT 1');
      this.client = client;
      this.lastSuccessAtMs = Date.now();
      if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
      this.logger.info('Realtime listener connected');
    } catch (error) {
      this.lastErrorAtMs = Date.now();
      await client.end().catch(() => undefined);
      throw error;
    } finally {
      this.connecting = false;
    }
  }

  private async heartbeat(): Promise<void> {
    if (this.stopped || this.heartbeatRunning) return;
    const client = this.client;
    if (client === undefined) {
      this.scheduleReconnect();
      return;
    }

    this.heartbeatRunning = true;
    try {
      await client.query('SELECT 1');
      if (this.client === client) this.lastSuccessAtMs = Date.now();
    } catch (error) {
      this.lastErrorAtMs = Date.now();
      if (this.client === client) this.client = undefined;
      this.logger.error({ err: error }, 'Realtime listener heartbeat failed');
      await client.end().catch(() => undefined);
      this.scheduleReconnect();
    } finally {
      this.heartbeatRunning = false;
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer !== undefined) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.reconnect();
    }, 1_000);
    this.reconnectTimer.unref();
  }

  private async reconnect(): Promise<void> {
    if (this.stopped) return;
    const previous = this.client;
    this.client = undefined;
    if (previous !== undefined) await previous.end().catch(() => undefined);

    try {
      await this.connect();
    } catch (error) {
      this.logger.error({ err: error }, 'Realtime listener reconnect failed');
      this.scheduleReconnect();
    }
  }
}
