/** Reconnecting public-feed socket (§5.1).
 *
 *  Contract: watch() NEVER throws. On drop we surface `error: 'disconnected'` so the UI
 *  can dim the readout rather than silently showing a frozen price. */

type Listener = (msg: Record<string, unknown>) => void;
type StatusListener = (connected: boolean) => void;

const WSImpl: typeof WebSocket | undefined =
  typeof WebSocket !== 'undefined' ? WebSocket : undefined;

export class PublicSocket {
  private ws: WebSocket | null = null;
  private closed = false;
  private attempt = 0;
  private readonly listeners = new Set<Listener>();
  private readonly statusListeners = new Set<StatusListener>();
  private readonly subscriptions = new Set<string>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly url: string,
    private readonly makeSocket: (url: string) => WebSocket = (u) => {
      if (!WSImpl) throw new Error('No WebSocket implementation; pass one in (Node: `ws`)');
      return new WSImpl(u);
    },
  ) {}

  connect(): void {
    if (this.closed || this.ws) return;
    let sock: WebSocket;
    try {
      sock = this.makeSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = sock;

    sock.onopen = () => {
      this.attempt = 0;
      this.emitStatus(true);
      for (const marketId of this.subscriptions) this.send({ op: 'subscribe', channel: 'market', marketId });
    };
    sock.onmessage = (ev: MessageEvent) => {
      try {
        const data = typeof ev.data === 'string' ? ev.data : String(ev.data);
        const parsed = JSON.parse(data) as Record<string, unknown>;
        for (const l of this.listeners) l(parsed);
      } catch {
        // A malformed frame is not a reason to tear down the feed.
      }
    };
    sock.onerror = () => { /* onclose always follows; handle it there. */ };
    sock.onclose = () => {
      this.ws = null;
      this.emitStatus(false);
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;
    const delay = Math.min(30_000, 500 * 2 ** this.attempt++) + Math.random() * 250;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private emitStatus(connected: boolean): void {
    for (const l of this.statusListeners) l(connected);
  }

  send(payload: unknown): void {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(payload));
  }

  /** Gotcha §8.6 — subscribe by marketId, never by pool address. */
  subscribeMarket(marketId: string): void {
    this.subscriptions.add(marketId);
    this.send({ op: 'subscribe', channel: 'market', marketId });
  }

  unsubscribeMarket(marketId: string): void {
    this.subscriptions.delete(marketId);
    this.send({ op: 'unsubscribe', channel: 'market', marketId });
  }

  onMessage(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  onStatus(l: StatusListener): () => void {
    this.statusListeners.add(l);
    return () => this.statusListeners.delete(l);
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }
}
