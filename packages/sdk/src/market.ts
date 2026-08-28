import { createPublicClient, http, type PublicClient } from 'viem';
import type { BullrunConfig } from './config.js';
import { shannon } from './config.js';
import { RestClient, normalizeMarket } from './rest.js';
import { PublicSocket } from './ws.js';
import { binaryMarketsModuleAbi, erc20Abi } from './abi.js';
import { snapPrice, snapSize, expireTimestampNs, DEFAULT_TIME_IN_FORCE } from './ticks.js';
import { CODE_BY_STATUS, type MarketState, type MarketSummary, type Position, type Side, type VenueAddresses } from './types.js';

/** A signed-order transport. The reference implementation lives in
 *  github.com/somnia-chain/dreamdex-bot-kit `packages/core` — auth, REST, WS, order
 *  execution, nonce management and the gotcha guards, in TS and Python (§2). Use it
 *  rather than rewriting: wire it in here and every screen gets book trading. */
export interface OrderSubmitter {
  submit(order: {
    marketId: string;
    side: Side;
    /** Base units on the 18-decimal grid, already snapped. Never a float (§8.2). */
    price: bigint;
    size: bigint;
    timeInForce: 'IOC' | 'GTC';
    expireTimestampNs: bigint;
  }): Promise<{ txHash: `0x${string}`; filled: bigint }>;
}

const notWired: OrderSubmitter = {
  async submit() {
    throw new Error(
      'No OrderSubmitter wired. Book trading (S3 "Trade on book") needs the signed-order ' +
      'client from dreamdex-bot-kit packages/core. Duels do not need it — they go straight ' +
      'through DuelEscrow. Pass one to `new MarketAdapter(cfg, { orders })`.',
    );
  },
};

export interface MarketAdapterOptions {
  orders?: OrderSubmitter;
  apiKey?: string;
  /** Node needs an explicit WebSocket ctor (`ws`); browsers do not. */
  makeSocket?: (url: string) => WebSocket;
  /** Escrow-free read client; supply your own to share one across adapters. */
  publicClient?: PublicClient;
  tickSize?: bigint;
  lotSize?: bigint;
}

/** §5.1 — read + book writes. Composes with DuelAdapter; neither replaces the other. */
export class MarketAdapter {
  readonly rest: RestClient;
  readonly publicClient: PublicClient;
  private readonly socket: PublicSocket;
  private readonly orders: OrderSubmitter;
  private readonly tickSize: bigint;
  private readonly lotSize: bigint;
  private venue: VenueAddresses | null = null;
  private connected = true;
  /** Gotcha §8.6 — the cache is keyed by marketId. Never by pool address. */
  private readonly cache = new Map<string, MarketState>();

  constructor(private readonly cfg: BullrunConfig, opts: MarketAdapterOptions = {}) {
    this.rest = new RestClient(cfg, opts.apiKey);
    this.publicClient = opts.publicClient ?? (createPublicClient({
      chain: shannon,
      transport: http(cfg.rpcUrl),
    }) as PublicClient);
    this.socket = opts.makeSocket
      ? new PublicSocket(cfg.wsUrl, opts.makeSocket)
      : new PublicSocket(cfg.wsUrl);
    this.orders = opts.orders ?? notWired;
    this.tickSize = opts.tickSize ?? 10n ** 15n; // 0.001 on an 18-decimal venue
    this.lotSize = opts.lotSize ?? 10n ** 15n;

    this.socket.onStatus((up) => {
      this.connected = up;
      // §5.1 — on drop, re-emit every cached market carrying error: 'disconnected'
      // so the UI dims the readout instead of showing a frozen price.
      for (const [id, state] of this.cache) {
        this.push(id, up ? { ...state, error: undefined } : { ...state, error: 'disconnected' });
      }
    });
    this.socket.onMessage((msg) => this.ingest(msg));
  }

  async addresses(): Promise<VenueAddresses> {
    this.venue ??= await this.rest.venueAddresses();
    return this.venue;
  }

  async listMarkets(): Promise<MarketSummary[]> {
    const markets = await this.rest.listMarkets();
    for (const m of markets) this.cache.set(m.marketId, stripSummary(m));
    return markets;
  }

  /** Gotcha §8.8 — settled markets are hidden from the default sweep. */
  listFinalizedMarkets(): Promise<MarketSummary[]> {
    return this.rest.listFinalizedMarkets();
  }

  // ------------------------------------------------------------------ watch

  private readonly subs = new Map<string, Set<(s: MarketState) => void>>();

  /** Emits a FRESH object on every update; consumers diff by value (§5.1).
   *  Never throws — transport failures arrive as `state.error`. */
  watch(marketId: string, onUpdate: (state: MarketState) => void): () => void {
    let set = this.subs.get(marketId);
    if (!set) {
      set = new Set();
      this.subs.set(marketId, set);
      this.socket.connect();
      this.socket.subscribeMarket(marketId);
      // Seed from REST so the first paint is real data, not a blank row.
      this.rest.listMarkets()
        .then((all) => {
          const hit = all.find((m) => m.marketId === marketId);
          if (hit) this.push(marketId, stripSummary(hit));
        })
        .catch((e) => this.push(marketId, {
          ...(this.cache.get(marketId) ?? emptyState(marketId)),
          error: String(e instanceof Error ? e.message : e),
        }));
    }
    set.add(onUpdate);

    const cached = this.cache.get(marketId);
    if (cached) onUpdate({ ...cached, error: this.connected ? cached.error : 'disconnected' });

    return () => {
      const s = this.subs.get(marketId);
      if (!s) return;
      s.delete(onUpdate);
      if (s.size === 0) {
        this.subs.delete(marketId);
        this.socket.unsubscribeMarket(marketId);
      }
    };
  }

  private ingest(msg: Record<string, unknown>): void {
    const payload = (msg['data'] ?? msg['market'] ?? msg) as Record<string, unknown>;
    let next: MarketState;
    try {
      next = stripSummary(normalizeMarket(payload));
    } catch {
      return; // Not a market frame.
    }
    if (!this.subs.has(next.marketId) && !this.cache.has(next.marketId)) return;
    const prev = this.cache.get(next.marketId);
    // The feed may send partial frames; keep known values rather than zeroing them.
    const merged: MarketState = prev ? { ...prev, ...pruneZeros(next, prev) } : next;
    this.push(next.marketId, merged);
  }

  private push(marketId: string, state: MarketState): void {
    this.cache.set(marketId, state);
    const listeners = this.subs.get(marketId);
    if (!listeners) return;
    for (const l of listeners) l({ ...state }); // fresh object every time
  }

  // ------------------------------------------------------------------ writes

  /** Gotcha §8.1 — read on-chain status before EVERY write. The indexer lags by
   *  seconds; an order on a just-locked market reverts, or on old SDK versions
   *  appears to succeed. */
  async assertTradingOnChain(marketId: `0x${string}`): Promise<void> {
    const { module } = await this.addresses();
    const status = await this.publicClient.readContract({
      address: module,
      abi: binaryMarketsModuleAbi,
      functionName: 'marketStatus',
      args: [marketId],
    });
    if (Number(status) !== CODE_BY_STATUS.Trading) {
      throw new Error(`market ${marketId} is not Trading on-chain (status ${status})`);
    }
  }

  /** Solo book trade. `cost` is what you are willing to spend, in collateral base units. */
  async buy(marketId: `0x${string}`, side: Side, cost: bigint): Promise<Position> {
    await this.assertTradingOnChain(marketId);
    const state = this.cache.get(marketId) ?? (await this.listMarkets()).find((m) => m.marketId === marketId);
    if (!state) throw new Error(`unknown market ${marketId}`);

    const probability = side === 'up' ? state.upPrice : 1 - state.upPrice;
    const price = snapPrice(probability, this.tickSize);          // §8.2 — bigint, on the grid
    const rawSize = (cost * 10n ** 18n) / price;
    const size = snapSize(rawSize, this.lotSize);                 // §8.3 — skip if it rounds to 0
    if (size === null) throw new Error('size rounds to zero on the lot grid — order skipped');

    const { txHash, filled } = await this.orders.submit({
      marketId, side, price, size,
      timeInForce: DEFAULT_TIME_IN_FORCE,                          // §8.5 — IOC for taker flow
      expireTimestampNs: expireTimestampNs(30),                    // §8.4 — mandatory, dead-man's switch
    });
    return { marketId, side, size: filled, txHash };
  }

  /** Sells the whole position back to the book. Duel legs have no book exit by design (§6.1 S6). */
  async sell(marketId: `0x${string}`, side: Side, size: bigint): Promise<{ proceeds: bigint; txHash: `0x${string}` }> {
    await this.assertTradingOnChain(marketId);
    const state = this.cache.get(marketId);
    if (!state) throw new Error(`unknown market ${marketId}`);
    const probability = side === 'up' ? state.upPrice : 1 - state.upPrice;
    const price = snapPrice(probability, this.tickSize);
    const snapped = snapSize(size, this.lotSize);
    if (snapped === null) throw new Error('size rounds to zero on the lot grid — order skipped');

    const { txHash, filled } = await this.orders.submit({
      marketId, side, price, size: snapped,
      timeInForce: DEFAULT_TIME_IN_FORCE,
      expireTimestampNs: expireTimestampNs(30),
    });
    return { proceeds: (filled * price) / 10n ** 18n, txHash };
  }

  /** Gotcha §8.7 — reconcile against the WALLET, not the vault. The per-pool vault is a
   *  payout fallback and reads 0 in normal operation. Check this before signing. */
  async balance(owner: `0x${string}`): Promise<bigint> {
    const { collateral } = await this.addresses();
    return this.publicClient.readContract({
      address: collateral, abi: erc20Abi, functionName: 'balanceOf', args: [owner],
    });
  }

  async collateralDecimals(): Promise<number> {
    const { collateral } = await this.addresses();
    return Number(await this.publicClient.readContract({
      address: collateral, abi: erc20Abi, functionName: 'decimals',
    }));
  }

  close(): void { this.socket.close(); }
}

function stripSummary(m: MarketSummary): MarketState {
  const { poolAddress: _pool, ...state } = m;
  return state;
}

/** Partial frames arrive with unknown numerics as 0; do not clobber known values. */
function pruneZeros(next: MarketState, prev: MarketState): Partial<MarketState> {
  const out: Partial<MarketState> = { ...next };
  for (const k of ['strike', 'spot', 'upPrice', 'openTime', 'expiryTime', 'intervalSec'] as const) {
    if (next[k] === 0 && prev[k] !== 0) delete out[k];
  }
  if (next.symbol === 'UNKNOWN') delete out.symbol;
  return out;
}

function emptyState(marketId: string): MarketState {
  return {
    marketId, symbol: 'UNKNOWN', intervalSec: 0, strike: 0, spot: 0, upPrice: 0,
    status: 'Listed', openTime: 0, expiryTime: 0, upLiquid: false, downLiquid: false,
    oracleQuestionId: null,
  };
}
