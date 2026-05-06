import WebSocket from 'ws';
import { EventEmitter } from 'events';

/**
 * Helius/Solana logsSubscribe stream. Emits 'signature' for every transaction
 * whose logs mention the watched program ID. Handles reconnect with
 * exponential backoff (1s -> 30s cap).
 *
 * We deliberately don't try to decode anything in here. Parsing is a separate
 * concern, and the WS may deliver duplicates across reconnects — the consumer
 * deduplicates by signature.
 */
export class LogsStream extends EventEmitter {
  private ws: WebSocket | null = null;
  private subId: number | null = null;
  private reqId = 1;
  private backoffMs = 1000;
  private stopped = false;
  private pingTimer: NodeJS.Timeout | null = null;

  constructor(
    private url: string,
    private programId: string,
  ) {
    super();
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
  }

  private connect(): void {
    if (this.stopped) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.on('open', () => {
      this.backoffMs = 1000;
      this.emit('open');
      this.subscribe();
      // Keep the connection warm. Helius will close idle sockets after ~60s.
      this.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.ping();
      }, 30_000);
    });

    ws.on('message', (raw) => this.onMessage(raw.toString()));

    ws.on('error', (err) => {
      this.emit('error', err);
    });

    ws.on('close', (code, reason) => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      this.subId = null;
      this.emit('close', { code, reason: reason.toString() });
      if (this.stopped) return;
      const delay = this.backoffMs;
      this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
      setTimeout(() => this.connect(), delay);
    });
  }

  private subscribe(): void {
    if (!this.ws) return;
    const id = this.reqId++;
    const msg = {
      jsonrpc: '2.0',
      id,
      method: 'logsSubscribe',
      params: [
        { mentions: [this.programId] },
        { commitment: 'confirmed' },
      ],
    };
    this.ws.send(JSON.stringify(msg));
  }

  private onMessage(raw: string): void {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    // Subscription confirmation: { id, result: <subId> }
    if (typeof msg.result === 'number' && msg.id !== undefined) {
      this.subId = msg.result;
      this.emit('subscribed', this.subId);
      return;
    }

    // Notification: { method: 'logsNotification', params: { result: { value: { signature, err, logs } }, subscription } }
    if (msg.method === 'logsNotification') {
      const value = msg.params?.result?.value;
      if (!value) return;
      if (value.err) return; // failed tx, skip
      const signature: string | undefined = value.signature;
      if (!signature) return;
      this.emit('signature', { signature, logs: value.logs ?? [] });
    }
  }
}
