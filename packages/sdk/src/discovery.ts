import {
  SomniaMarkets, SOMNIA_TESTNET_PRICE_FEED, resolveIntervalSec,
  type BinaryMarket, type SomniaMarketsClient, type PriceWatchHandle,
} from '@somnia-chain/markets-sdk';
import type { BullrunConfig } from './config.js';
import type { MarketState, MarketStatus, MarketSummary } from './types.js';

/**
 * Binary (event-contract) market discovery.
 *
 * NOT the REST registry. Verified 2026-08-29: `GET /v0/markets` serves spot and
 * perp only — its `kind` enum is ["spot","perp","all"] and it silently ignores
 * anything else, which is why it looks like it works. Event contracts live in
 * the indexer, reached through @somnia-chain/markets-sdk. See docs/FINDINGS.md.
 */

/** The venue fields DuelEscrow needs to act on a market. Carried alongside the
 *  display state so a screen never has to go back to the indexer to open a duel. */
export interface BinaryRef {
  /** bytes32 primary key. Key everything by this (gotcha §8.6). */
  marketId: `0x${string}`;
  /** Pools are RECYCLED across windows; `nonce` is what disambiguates them. */
  poolAddress: `0x${string}`;
  nonce: bigint;
  /** ERC-6909 ids, supplied by the indexer — no derivation needed at runtime.
   *  They equal outcomeId(pool, nonce, idx), which this SDK's own helper
   *  reproduces exactly (verified against ten live markets). §9 unknown #3. */
  upId: bigint;
  downId: bigint;
  /** mintCompleteSet/redeem are scoped by the market's ORIGIN venue, not the
   *  venue you happen to be reading through. */
  operatorId: number;
  venueId: `0x${string}`;
  collateral: `0x${string}`;
  /** Outcome-token and collateral decimals for this market. */
  decimals: number;
}

export interface BinaryMarketSummary extends MarketSummary {
  ref: BinaryRef;
}

/** Indexer status strings → our lifecycle. */
function toStatus(raw: string, voided: boolean): MarketStatus {
  if (voided) return 'Voided';
  const s = raw.toLowerCase();
  if (s.startsWith('trad')) return 'Trading';
  if (s.startsWith('lock')) return 'Locked';
  if (s.startsWith('settl')) return 'Settling';
  if (s.startsWith('resolv') || s.startsWith('final')) return 'Resolved';
  if (s.startsWith('void') || s.startsWith('cancel')) return 'Voided';
  return 'Listed';
}

const num = (v: string | null | undefined): number =>
  v === null || v === undefined || v === '' ? 0 : Number(v);

export class MarketDiscovery {
  private exchange: SomniaMarkets | null = null;
  /** Oracle price scale per asset, inferred once — see `strikeScaleFor`. */
  private readonly scales = new Map<string, number>();
  private readonly watchedAssets = new Set<string>();
  /** Live price subscriptions. They hold the process open until stopped, which
   *  is why close() is not optional in a script. */
  private readonly priceWatches: PriceWatchHandle[] = [];

  constructor(private readonly cfg: BullrunConfig) {}

  private get ex(): SomniaMarkets {
    this.exchange ??= new SomniaMarkets({
      indexerUrl: this.cfg.indexerUrl,
      chain: this.cfg.chain,
      wsRpcUrl: this.cfg.wsRpcUrl,
      // Bundled on testnet only. Without it `spot` stays 0 and the UI must not
      // pretend otherwise — the market row never carries the underlying price.
      ...(this.cfg.network === 'testnet' ? { priceFeed: SOMNIA_TESTNET_PRICE_FEED } : {}),
    });
    return this.exchange;
  }

  get client(): SomniaMarketsClient { return this.ex.client; }

  // ------------------------------------------------------------------ reads

  /** Live markets, soonest to expire first.
   *
   *  Every venue unless VENUE_ID pins one. Scoping by default hid the short
   *  windows entirely — on Shannon the 1m/5m markets sit on a different venue
   *  than the 1h/4h/24h ones. See `scopeToVenue` in config.ts. */
  async listLive(): Promise<BinaryMarketSummary[]> {
    const rows = await this.client.listLiveBinaryMarkets(
      this.cfg.scopeToVenue ? { venueId: this.cfg.venueId } : undefined,
    );
    return this.hydrate(rows);
  }

  /** Gotcha §8.8 — settled markets leave the live list, and the registry sweep
   *  skips finalized binaries entirely, so unclaimed winnings look like no
   *  winnings. They have to be asked for by name. */
  async listSettled(limit = 25): Promise<BinaryMarketSummary[]> {
    const rows = await this.client.listPastBinaryMarkets({ limit });
    return this.hydrate(rows);
  }

  async get(marketId: string): Promise<BinaryMarketSummary | null> {
    const row = await this.client.getBinaryMarket(marketId);
    if (!row) return null;
    return (await this.hydrate([row]))[0] ?? null;
  }

  /** Every asset with a live market, so a caller can start the price feed. */
  async assets(): Promise<string[]> {
    return this.client.listBinaryAssets();
  }

  // ----------------------------------------------------------- the underlying

  /** Starts the underlying BTC/ETH feed. Idempotent per asset.
   *  The market row carries only the CONTRACT's own price — a probability.
   *  Reading direction from that is circular; only the feed knows where BTC is. */
  async watchUnderlying(assets: string[]): Promise<void> {
    const fresh = assets.filter((a) => !this.watchedAssets.has(a));
    if (!fresh.length) return;
    for (const a of fresh) this.watchedAssets.add(a);
    try { this.priceWatches.push(await this.client.watchPrices(fresh)); }
    catch { for (const a of fresh) this.watchedAssets.delete(a); }
  }

  underlying(asset: string): number {
    try { return this.client.getLivePrice(asset)?.price ?? 0; }
    catch { return 0; }
  }

  /** Stops the price feed. Without it a Node process never exits. */
  close(): void {
    for (const h of this.priceWatches) {
      try { h.stop(); } catch { /* already gone */ }
    }
    this.priceWatches.length = 0;
    this.watchedAssets.clear();
  }

  /**
   * The oracle's price scale for an asset.
   *
   * `strike` is documented as "raw, in the oracle's price scale" and that scale
   * is exposed nowhere — not on the market row, not on the answer. Parsing it
   * out of the question text is precisely what gotcha §8.9 forbids, and the
   * wording has already changed several times.
   *
   * So it is inferred: the strike and the live underlying describe the same
   * price, so their ratio rounds to the power of ten between them. Measured on
   * Shannon this is 1e2 (strike 7749385 against a feed price of 77481). Cached
   * per asset, and only ever computed from a real feed reading.
   */
  private strikeScaleFor(asset: string, rawStrike: number): number {
    const cached = this.scales.get(asset);
    if (cached) return cached;
    const spot = this.underlying(asset);
    if (spot > 0 && rawStrike > 0) {
      const scale = 10 ** Math.round(Math.log10(rawStrike / spot));
      if (scale >= 1 && scale <= 1e18) {
        this.scales.set(asset, scale);
        return scale;
      }
    }
    return DEFAULT_STRIKE_SCALE;
  }

  // ------------------------------------------------------------- normalizing

  private async hydrate(rows: BinaryMarket[]): Promise<BinaryMarketSummary[]> {
    if (!rows.length) return [];

    const ids = rows.map((r) => r.marketId);

    // The price feed hydrates a snapshot and opens a socket. Awaiting it here
    // held the FIRST market list — and so the first frame — behind the slowest
    // thing in the chain. Start it and move on: `spot` fills in on the next
    // poll, and the strike scale falls back until it reports.
    void this.watchUnderlying([...new Set(rows.map((r) => r.asset))]);

    // In parallel, not one after another. Serially these three round trips were
    // the difference between a console that appears and one you wait for.
    //
    // Book tops: one round trip for every book rather than an N+1 fan-out; a
    // market with no resting orders is simply absent from the map.
    //
    // Opening prices: reference-mode markets carry `strike: "0"` — the price
    // they resolve against is the REFERENCE question's opening answer, posted
    // when the window opens, not a number fixed at creation. Without it the
    // strike reads zero and the up/down question is meaningless. Fixed-strike
    // markets are absent from this map and keep their own strike.
    const [tops, opening] = await Promise.all([
      this.client.getBookTops(ids)
        .catch(() => ({} as Record<string, { bestBid: string | null; bestAsk: string | null; mid: string | null }>)),
      this.client.getOpeningPrices(ids)
        .catch(() => ({} as Record<string, string | null>)),
    ]);

    return rows.map((r) => {
      const key = r.marketId.toLowerCase();
      return this.toSummary(r, tops[key], opening[key] ?? null);
    });
  }

  private toSummary(
    m: BinaryMarket,
    top?: { bestBid: string | null; bestAsk: string | null; mid: string | null },
    openingPrice?: string | null,
  ): BinaryMarketSummary {
    const quoteUnit = 10 ** m.quoteDecimals;

    // Implied probability of UP. The book's mid is the live read; lastPrice is
    // the fallback, and 0.5 only when the market has never traded.
    const midRaw = top?.mid ?? m.lastPrice;
    const upPrice = midRaw !== null && midRaw !== undefined
      ? Math.min(0.99, Math.max(0.01, num(midRaw) / quoteUnit))
      : 0.5;

    // The window's opening price: the market's own strike when it has one,
    // otherwise the reference question's opening answer.
    const rawStrike = num(m.strike) || num(openingPrice);
    const scale = this.strikeScaleFor(m.asset, rawStrike);

    const state: MarketState = {
      marketId: m.marketId,
      // Gotcha §8.9 — typed fields, never the question text.
      symbol: m.asset,
      intervalSec: resolveIntervalSec(m) ?? num(m.intervalSec),
      strike: rawStrike / scale,
      spot: this.underlying(m.asset),
      upPrice,
      status: toStatus(m.status, m.voided),
      openTime: num(m.tradingStart),
      expiryTime: num(m.expiry),
      upLiquid: Boolean(top?.bestAsk),
      downLiquid: Boolean(top?.bestBid),
      oracleQuestionId: m.oracleQuestionId ?? null,
    };

    return {
      ...state,
      poolAddress: m.poolAddress,
      ref: {
        marketId: m.marketId,
        poolAddress: m.poolAddress,
        nonce: BigInt(m.nonce ?? 0),
        upId: BigInt(m.yesTokenId),
        downId: BigInt(m.noTokenId),
        operatorId: m.operatorId ?? 0,
        venueId: (m.venueId ?? '0x') as `0x${string}`,
        collateral: m.collateral,
        decimals: m.quoteDecimals,
      },
    };
  }
}

/** Observed on Shannon. Only used when the price feed has not reported yet —
 *  mainnet ships no bundled feed, so confirm it there before trusting it. */
export const DEFAULT_STRIKE_SCALE = 100;
