import { createPublicClient, http, type PublicClient } from 'viem';
import type { TradeRushConfig } from './config.js';
import { MarketDiscovery, type BinaryMarketSummary, type OpeningStore } from './discovery.js';
import { binaryModuleReadAbi, erc20Abi, MARKET } from './abi.js';
import { expireTimestampNs, DEFAULT_TIME_IN_FORCE } from './ticks.js';
import { type MarketState, type Position, type Side, type VenueAddresses } from './types.js';

/** A signed-order transport. The reference implementation lives in
 *  github.com/somnia-chain/dreamdex-bot-kit `packages/core` — auth, REST, WS, order
 *  execution, nonce management and the gotcha guards, in TS and Python (§2). Use it
 *  rather than rewriting: wire it in here and every screen gets book trading. */
export interface OrderSubmitter {
  submit(order: {
    marketId: string;
    /** Buying escrows collateral; selling escrows outcome tokens. The venue
     *  needs to know which — the side alone does not say it. */
    action: 'buy' | 'sell';
    side: Side;
    /**
     *  A BUDGET on a buy (collateral, raw) and a QUANTITY on a sell (outcome
     *  tokens, raw).
     *
     *  Not a price and a size: the venue quotes an order by sweeping the live
     *  book from one of those two, and it is the sweep that decides both the
     *  protective limit and the fillable quantity. Handing it a price computed
     *  up here — off a mid, off a top of book, off a tick grid taken from
     *  config — is how this path produced three different reverts.
     */
    amount: bigint;
    timeInForce: 'IOC' | 'GTC';
    expireTimestampNs: bigint;
  }): Promise<{ txHash: `0x${string}`; filled: bigint }>;
}

const notWired: OrderSubmitter = {
  async submit() {
    throw new Error(
      'No OrderSubmitter wired. Build one with makeOrderSubmitter() and hand it over with ' +
      'setOrderSubmitter() once a wallet is connected. Rooms and duels do not need it — ' +
      'they go straight through their escrows.',
    );
  },
};

export interface MarketAdapterOptions {
  orders?: OrderSubmitter;
  /** Escrow-free read client; supply your own to share one across adapters. */
  publicClient?: PublicClient;
  tickSize?: bigint;
  lotSize?: bigint;
  /** How often watch() re-reads the indexer. */
  pollMs?: number;
  /** Where opening prices survive a reload — see `OpeningStore`. Without one
   *  they are still cached, just only for the life of this adapter. */
  openings?: OpeningStore;
}

/** §5.1 — read + book writes. Composes with DuelAdapter; neither replaces the other. */
export class MarketAdapter {
  readonly discovery: MarketDiscovery;
  readonly publicClient: PublicClient;
  private orders: OrderSubmitter;
  private readonly tickSize: bigint;
  private readonly lotSize: bigint;
  private venue: VenueAddresses | null = null;
  private readonly pollMs: number;
  private poller: ReturnType<typeof setInterval> | null = null;
  /** Gotcha §8.6 — the cache is keyed by marketId. Never by pool address. */
  private readonly cache = new Map<string, MarketState>();

  constructor(private readonly cfg: TradeRushConfig, opts: MarketAdapterOptions = {}) {
    this.discovery = new MarketDiscovery(cfg, opts.openings);
    this.publicClient = opts.publicClient ?? (createPublicClient({
      chain: cfg.chain,
      transport: http(cfg.rpcUrl),
    }) as PublicClient);
    this.orders = opts.orders ?? notWired;
    this.pollMs = opts.pollMs ?? 3_000;
    // Binary market rows carry no tickSize/lotSize (unlike spot), so these are NOT
    // discoverable and come from the network deployment: 1e15 on mainnet, 1e3 on
    // testnet. Hard-coding the mainnet grid would reject every testnet order.
    this.tickSize = opts.tickSize ?? cfg.tick;
    this.lotSize = opts.lotSize ?? cfg.lot;

  }

  /** Venue addresses come from the bundled per-network deployment map, NOT from
   *  GET /v0/markets. Verified 2026-08-29: that endpoint's `kind` enum is
   *  ["spot","perp","all"] — it has no binary tier at all, on either host, so the
   *  PRD's "re-fetchable at runtime from GET /markets" does not hold for event
   *  contracts. The map is overridable per address from env for the case where a
   *  redeploy lands before this repo is updated. */
  addresses(): Promise<VenueAddresses> {
    this.venue ??= {
      collateral: this.cfg.addresses.collateral,
      module: this.cfg.addresses.binaryModule,
      // VERIFY (§9 unknown #3): the bot kit's deployment map has no separate
      // outcome-token entry, which implies the binaryModule IS the ERC-6909
      // singleton. `pnpm probe` confirms it by checking balanceOf after a mint.
      outcomeToken: this.cfg.addresses.binaryModule,
    };
    return Promise.resolve(this.venue);
  }

  /** Collateral decimals for the ACTIVE network: 6 on testnet (tUSDC), 18 on
   *  mainnet (USDso). Read this — never assume 18. */
  get decimals(): number { return this.cfg.decimals; }
  get collateralSymbol(): string { return this.cfg.collateralSymbol; }

  /** Live event-contract markets. Reached through the indexer, NOT the REST
   *  registry — that one serves spot and perp only (docs/FINDINGS.md). */
  async listMarkets(): Promise<BinaryMarketSummary[]> {
    const markets = await this.discovery.listLive();
    for (const m of markets) this.cache.set(m.marketId, stripSummary(m));
    return markets;
  }

  /** Gotcha §8.8 — settled markets leave the live list, so unclaimed winnings
   *  look like no winnings unless they are asked for by name. */
  listFinalizedMarkets(limit?: number): Promise<BinaryMarketSummary[]> {
    return this.discovery.listSettled(limit);
  }

  /**
   * Top of book, from the pool itself, in raw collateral units.
   *
   * The indexer carries a top too and it is what the market list shows, but it
   * lags: on a live market the two read 95.40/97.80 against a real 96.40/98.50.
   * A point is nothing on a list and everything on a control — it decides
   * whether a key is offered and what number it promises. Anything a person is
   * about to act on comes from here.
   *
   * Both sides are YES prices. A DOWN position sells into `ask` (selling NO is
   * buying YES) and a DOWN entry pays `1 - bid`.
   */
  async bookTop(marketId: string): Promise<{ bid: bigint | null; ask: bigint | null } | null> {
    const hit = await this.discovery.get(marketId);
    if (!hit) return null;
    const book = await this.discovery.client.getBinaryOrderBook(hit.ref.poolAddress, {
      depth: 1, decimals: this.cfg.decimals,
    });
    return {
      bid: book.yesBids[0]?.price ?? null,
      ask: book.yesAsks[0]?.price ?? null,
    };
  }

  /** The venue fields DuelEscrow needs: outcome ids, origin venue, pool nonce. */
  async ref(marketId: string) {
    const hit = await this.discovery.get(marketId);
    return hit?.ref ?? null;
  }

  // ------------------------------------------------------------------ watch

  private readonly subs = new Map<string, Set<(s: MarketState) => void>>();

  /** Emits a FRESH object on every update; consumers diff by value (§5.1).
   *  Never throws — transport failures arrive as `state.error` so the UI can dim
   *  a stale readout rather than silently showing a frozen price.
   *
   *  Polls the indexer rather than riding a socket. The public DreamDEX feed
   *  carries spot and perp only, and the indexer lags the chain by seconds
   *  regardless (gotcha §8.1) — so polling IS the honest read, and anything
   *  about to be acted on is re-checked on-chain before the write.
   */
  watch(marketId: string, onUpdate: (state: MarketState) => void): () => void {
    let set = this.subs.get(marketId);
    if (!set) { set = new Set(); this.subs.set(marketId, set); }
    set.add(onUpdate);

    const cached = this.cache.get(marketId);
    if (cached) onUpdate({ ...cached });

    this.startPolling();

    return () => {
      const s = this.subs.get(marketId);
      if (!s) return;
      s.delete(onUpdate);
      if (s.size === 0) this.subs.delete(marketId);
      if (this.subs.size === 0) this.stopPolling();
    };
  }

  private startPolling(): void {
    if (this.poller) return;
    const tick = async () => {
      try {
        const rows = await this.discovery.listLive();
        const seen = new Set<string>();
        for (const row of rows) {
          seen.add(row.marketId);
          this.push(row.marketId, stripSummary(row));
        }
        // A market that has left the live list has settled, not vanished
        // (gotcha §8.8). Fetch it by name so a lobby does not freeze.
        for (const id of this.subs.keys()) {
          if (seen.has(id)) continue;
          const one = await this.discovery.get(id);
          if (one) this.push(id, stripSummary(one));
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        for (const [id, prev] of this.cache) {
          if (this.subs.has(id)) this.push(id, { ...prev, error: message });
        }
      }
    };
    void tick();
    this.poller = setInterval(() => void tick(), this.pollMs);
  }

  private stopPolling(): void {
    if (!this.poller) return;
    clearInterval(this.poller);
    this.poller = null;
  }

  private push(marketId: string, state: MarketState): void {
    this.cache.set(marketId, state);
    const listeners = this.subs.get(marketId);
    if (!listeners) return;
    for (const l of listeners) l({ ...state });  // fresh object every time
  }

  // ------------------------------------------------------------------ writes

  /** Gotcha §8.1 — read on-chain state before EVERY write. The indexer lags by
   *  seconds; an order on a just-locked market reverts, or on old SDK versions
   *  appears to succeed.
   *
   *  There is no `marketStatus()` on the module. `markets()` returns the record,
   *  and the trading window is what status means: open at `tradingStart`, shut
   *  at `expiry`. Deriving it from the chain's own clock is stronger than an
   *  indexed enum anyway. */
  async assertTradingOnChain(marketId: `0x${string}`): Promise<void> {
    const record = await this.publicClient.readContract({
      address: this.cfg.addresses.binaryModule,
      abi: binaryModuleReadAbi,
      functionName: 'markets',
      args: [marketId],
    }) as readonly unknown[];

    const pool = record[MARKET.pool] as `0x${string}`;
    if (!pool || /^0x0+$/.test(pool)) {
      throw new Error(`market ${marketId} does not exist on this module`);
    }
    const tradingStart = Number(record[MARKET.tradingStart]);
    const expiry = Number(record[MARKET.expiry]);
    const now = Math.floor(Date.now() / 1000);
    if (now < tradingStart) throw new Error(`market ${marketId} has not opened yet`);
    if (now >= expiry) throw new Error(`market ${marketId} expired at ${expiry}`);
  }

  /**
   * Hand the adapter a way to sign orders.
   *
   * The adapter is built once, when the app starts; the wallet arrives later and
   * can change. Taking the submitter in the constructor would mean rebuilding
   * the adapter — and with it the market cache and every live subscription —
   * every time someone signs in.
   */
  setOrderSubmitter(orders: OrderSubmitter | null): void {
    this.orders = orders ?? notWired;
  }

  /** Solo book trade. `cost` is what you are willing to spend, in collateral base units. */
  async buy(marketId: `0x${string}`, side: Side, cost: bigint): Promise<Position> {
    await this.assertTradingOnChain(marketId);
    const { txHash, filled } = await this.orders.submit({
      marketId, action: 'buy', side, amount: cost,
      timeInForce: DEFAULT_TIME_IN_FORCE,                          // §8.5 — IOC for taker flow
      expireTimestampNs: expireTimestampNs(30),                    // §8.4 — clamped to the market
    });
    return { marketId, side, size: filled, txHash };
  }

  /** Sells the whole position back to the book. Duel legs have no book exit by design (§6.1 S6). */
  async sell(marketId: `0x${string}`, side: Side, size: bigint): Promise<{ proceeds: bigint; txHash: `0x${string}` }> {
    await this.assertTradingOnChain(marketId);
    const { txHash, filled } = await this.orders.submit({
      marketId, action: 'sell', side, amount: size,
      timeInForce: DEFAULT_TIME_IN_FORCE,
      expireTimestampNs: expireTimestampNs(30),
    });
    // What came back is decided by the levels the sweep actually hit, so the
    // submitter reports it rather than this multiplying by a price it guessed.
    return { proceeds: filled, txHash };
  }

  /** Gotcha §8.7 — reconcile against the WALLET, not the vault. The per-pool vault is a
   *  payout fallback and reads 0 in normal operation. Check this before signing. */
  async balance(owner: `0x${string}`): Promise<bigint> {
    const { collateral } = await this.addresses();
    return this.publicClient.readContract({
      address: collateral, abi: erc20Abi, functionName: 'balanceOf', args: [owner],
    });
  }

  /** Reads decimals off the token, so a wrong entry in the deployment map fails
   *  loudly instead of mis-rendering every balance by a factor of 1e12. */
  async collateralDecimals(): Promise<number> {
    const { collateral } = await this.addresses();
    const onChain = Number(await this.publicClient.readContract({
      address: collateral, abi: erc20Abi, functionName: 'decimals',
    }));
    if (onChain !== this.cfg.decimals) {
      throw new Error(
        `collateral ${collateral} reports ${onChain} decimals but the ${this.cfg.network} ` +
        `deployment map says ${this.cfg.decimals}. Fix networks.ts or set DECIMALS.`,
      );
    }
    return onChain;
  }

  close(): void { this.stopPolling(); this.discovery.close(); }
}

function stripSummary(m: BinaryMarketSummary): MarketState {
  const { poolAddress: _pool, ref: _ref, ...state } = m;
  return state;
}


