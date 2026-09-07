import {
  SomniaMarkets, SOMNIA_TESTNET_PRICE_FEED, resolveIntervalSec,
  type BinaryMarket, type SomniaMarketsClient, type PriceWatchHandle,
} from '@somnia-chain/markets-sdk';
import type { TradeRushConfig } from './config.js';
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

/**
 * How long any one indexer query is allowed to hold a screen.
 *
 * Measured on Shannon: the same 0.5KB query answered in 812ms, 9.6s and 26.9s
 * within one minute, against a 500ms round trip to the same host for a trivial
 * one. The variance is the indexer's, not the network's, and nothing here can
 * make it faster — but waiting the worst case is a choice, and it was the wrong
 * one. Past this the answer is treated as absent, which every caller below
 * already handles: a market list falls back to what it last knew, and an
 * enrichment falls back to null.
 */
const LIST_DEADLINE_MS = 6_000;
/** Enrichment gets less. It decorates rows that are already on screen. */
const ENRICH_DEADLINE_MS = 3_500;

/** Stop WAITING at `ms`. The request is left to finish on its own — the markets
 *  SDK exposes no abort signal — so this bounds the screen, not the socket. */
function deadline<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); },
           () => { clearTimeout(timer); resolve(fallback); });
  });
}

export class MarketDiscovery {
  private exchange: SomniaMarkets | null = null;
  /** Oracle price scale per MARKET, inferred once — see `strikeScaleFor`. */
  private readonly scales = new Map<string, number>();
  private readonly watchedAssets = new Set<string>();
  /** Live price subscriptions. They hold the process open until stopped, which
   *  is why close() is not optional in a script. */
  private readonly priceWatches: PriceWatchHandle[] = [];
  /** Candle backfills, keyed by asset and window open. */
  private readonly candles = new Map<string, { t: number; price: number }[]>();
  /** The last list that actually arrived, and the fetch currently in flight.
   *  The console polls every five seconds against a query that has taken thirty;
   *  without these, every tick opened another request on a host already failing
   *  to answer the first, and the pile-up is its own cause. */
  private lastLive: BinaryMarketSummary[] | null = null;
  /** The raw rows behind `lastLive`. Kept so that an opening price arriving
   *  after the list has rendered can be folded into it on the spot, instead of
   *  making the screen wait out another eighteen-second list query to see a
   *  number that is already in hand. */
  private lastRaw: BinaryMarket[] | null = null;
  private liveInFlight: Promise<BinaryMarketSummary[]> | null = null;
  /** A window's opening price is fixed the moment the window opens — it is the
   *  answer the market resolves AGAINST, not a quote. Re-asking for it on every
   *  poll bought nothing and cost the slowest query in the set, so the first
   *  answer is kept for good. Without this the enrichment deadline below simply
   *  deleted `strike`, which is the whole up/down question. */
  private readonly openingPrices = new Map<string, string>();
  /** Book tops DO move, so these are only a floor: when a refresh does not come
   *  back in time the row keeps the last top it had instead of flipping to
   *  "no book" and back. */
  private readonly lastTops = new Map<string, { bestBid: string | null; bestAsk: string | null; mid: string | null }>();
  private openingsInFlight = false;

  constructor(private readonly cfg: TradeRushConfig) {}

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
    // One request at a time. Callers that arrive mid-flight join the one already
    // running rather than starting another.
    const flight = this.liveInFlight
      ??= this.fetchLive().finally(() => { this.liveInFlight = null; });

    // Known list: hand it back NOW and let the refresh land on its own. Waiting
    // on a query that answers in eighteen seconds, to replace rows five seconds
    // old with rows zero seconds old, is the whole delay and none of the value.
    // Every caller here polls, so the next tick collects what this one started.
    if (this.lastLive) {
      flight.catch(() => { /* the poll after this one tries again */ });
      return this.lastLive;
    }

    // Nothing known yet, so there is nothing to show instead: wait it out and
    // hand back what the indexer really says, including a rejection. An indexer
    // that is down has to read as down, not as a venue with no markets.
    return flight;
  }

  private async fetchLive(): Promise<BinaryMarketSummary[]> {
    const rows = await this.client.listLiveBinaryMarkets(
      this.cfg.scopeToVenue ? { venueId: this.cfg.venueId } : undefined,
    );
    // BEFORE hydrating, not after: `hydrate` starts the opening-price fetch, and
    // that fetch folds its answer back into `lastRaw`. Assigned afterwards, a
    // fetch that returned quickly found nothing to fold into and the strike sat
    // out the whole next refresh.
    this.lastRaw = rows;
    const hydrated = await this.hydrate(rows);
    this.lastLive = hydrated;
    return hydrated;
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

  /**
   * The underlying's recent tick tape, oldest first, trimmed to a window.
   *
   * The feed keeps roughly the last two hundred ticks — about three and a half
   * minutes — which is enough to draw a 1m or 5m window from its open instead
   * of from the moment someone happened to load the page. Longer windows get
   * whatever the tape reaches back to, which is still the truth about what was
   * observed rather than a line stretched to fill the glass.
   *
   * Synchronous and memoized: it costs nothing to ask on every poll.
   */
  priceHistory(asset: string, fromSec: number, toSec: number): { t: number; price: number }[] {
    try {
      const ticks = this.client.getLivePriceTicks(asset, { limit: 400 });
      return ticks
        .map((p) => ({ ts: Number(p.blockTimestamp), price: p.price }))
        .filter((p) => Number.isFinite(p.ts) && p.ts >= fromSec && p.ts <= toSec && p.price > 0)
        .sort((a, b) => a.ts - b.ts)
        .map((p) => ({ t: p.ts - fromSec, price: p.price }));
    } catch {
      return [];
    }
  }

  /**
   * Candles covering a whole window, for the dials the tick tape cannot reach.
   *
   * The tape holds about three and a half minutes, which draws a 1m or 5m
   * window whole and leaves an hour-long one starting most of the way across.
   * Candles fill the rest. Fetched out of band and cached per window — this
   * must never sit between a page load and the first frame.
   */
  async windowCandles(asset: string, fromSec: number, toSec: number): Promise<{ t: number; price: number }[]> {
    const key = `${asset}:${fromSec}`;
    const cached = this.candles.get(key);
    if (cached) return cached;

    const span = toSec - fromSec;
    // Minute candles up to a few hours; beyond that an hourly one is plenty for
    // a trail 380 pixels wide.
    const resolution = span <= 4 * 3600 ? 'M1' : 'H1';
    try {
      const rows = await this.ex.client.fetchPriceCandles(asset, resolution, {
        from: fromSec, to: toSec, limit: 400,
      });
      const points = rows
        .map((r) => ({ ts: Number(r.bucketStart), price: Number(r.close || r.open) }))
        .filter((r) => Number.isFinite(r.ts) && r.ts >= fromSec && r.ts <= toSec && r.price > 0)
        .sort((a, b) => a.ts - b.ts)
        .map((r) => ({ t: r.ts - fromSec, price: r.price }));
      this.candles.set(key, points);
      return points;
    } catch {
      this.candles.set(key, []);
      return [];
    }
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
   * The oracle's price scale for ONE MARKET.
   *
   * `strike` is documented as "raw, in the oracle's price scale" and that scale
   * is exposed nowhere — not on the market row, not on the answer. Parsing it
   * out of the question text is precisely what gotcha §8.9 forbids, and the
   * wording has already changed several times.
   *
   * So it is inferred: the strike and the live underlying describe the same
   * price, so their ratio rounds to the power of ten between them.
   *
   * PER MARKET, not per asset — this was keyed by asset and the two are not the
   * same thing. Measured on Shannon within one minute, same feed price of
   * 78818.72:
   *
   *     BTC 24H    opening 8034670        -> 1e2
   *     BTC 1080H  opening 7961075000000  -> 1e8
   *
   * One asset, two live windows, six orders of magnitude apart. Keyed by asset,
   * whichever window hydrated first set the divisor for the other, and the
   * 1080H strike came out a million times too large. The scale belongs to the
   * question a market resolves against, and each market has its own.
   *
   * Returns null rather than guessing when the feed has not reported: there is
   * nothing to take a ratio against, and a wrong strike is worse than no strike.
   */
  private strikeScaleFor(marketId: string, asset: string, rawStrike: number): number | null {
    const cached = this.scales.get(marketId);
    if (cached) return cached;
    const spot = this.underlying(asset);
    if (spot > 0 && rawStrike > 0) {
      const scale = 10 ** Math.round(Math.log10(rawStrike / spot));
      if (scale >= 1 && scale <= 1e18) {
        this.scales.set(marketId, scale);
        return scale;
      }
    }
    return null;
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
    //
    // Both are bounded. `getBookTops` was measured hanging past twenty-five
    // seconds and then failing — and because the failure was caught but never
    // timed, the whole list waited for it before rendering rows that did not
    // need it. A book top that is not back in three and a half seconds is a
    // book top the row renders without.
    // Openings are fetched OFF this path — see `primeOpenings`.
    void this.primeOpenings(ids);

    const tops = await deadline(
      this.client.getBookTops(ids),
      ENRICH_DEADLINE_MS,
      null as Record<string, { bestBid: string | null; bestAsk: string | null; mid: string | null }> | null,
    );
    for (const [k, v] of Object.entries(tops ?? {})) this.lastTops.set(k.toLowerCase(), v);

    return rows.map((r) => {
      const key = r.marketId.toLowerCase();
      return this.toSummary(r, tops?.[key] ?? this.lastTops.get(key), this.openingPrices.get(key) ?? null);
    });
  }

  /**
   * Fill in opening prices without holding anything up.
   *
   * Every live window here is reference-mode — `strike` arrives as "0" and the
   * price the market resolves against is the reference question's opening
   * answer. So this is not decoration: without it `strike` is zero and the
   * up/down question means nothing.
   *
   * Which is exactly why it cannot sit behind a deadline on the render path.
   * Measured: 2.4s, 9.3s, 8.6s, then a 30s failure. Any bound short enough to
   * protect the list is short enough to delete the strike most of the time, and
   * a bound long enough to catch it is longer than the list is worth waiting
   * for. So it runs beside the list instead, retried by each poll until it
   * lands, and kept for good once it does — an opening price is fixed when the
   * window opens and never moves.
   */
  private async primeOpenings(ids: string[]): Promise<void> {
    const missing = ids.filter((id) => !this.openingPrices.has(id.toLowerCase()));
    if (!missing.length || this.openingsInFlight) return;
    this.openingsInFlight = true;
    try {
      const opening = await this.client.getOpeningPrices(missing);
      let learned = false;
      for (const [k, v] of Object.entries(opening)) {
        if (v !== null && v !== undefined && v !== '') {
          this.openingPrices.set(k.toLowerCase(), v);
          learned = true;
        }
      }
      // Fold it straight into the list already on screen. No network, no list
      // query — the rows are held for exactly this. Without it the strike is
      // correct but arrives a whole refresh late, which is the part that reads
      // as broken: a number that shows up eventually, at no time you can name.
      if (learned && this.lastRaw) {
        this.lastLive = this.lastRaw.map((r) => {
          const key = r.marketId.toLowerCase();
          return this.toSummary(r, this.lastTops.get(key), this.openingPrices.get(key) ?? null);
        });
      }
    } catch {
      // The next poll asks again. Nothing on screen depends on this having
      // worked THIS time.
    } finally {
      this.openingsInFlight = false;
    }
  }

  private toSummary(
    m: BinaryMarket,
    top?: { bestBid: string | null; bestAsk: string | null; mid: string | null },
    openingPrice?: string | null,
  ): BinaryMarketSummary {
    const quoteUnit = 10 ** m.quoteDecimals;

    // Implied probability of UP. The book's mid is the live read; lastPrice is
    // the fallback, and 0.5 only when the market has never traded.
    // Raw book prices are in quote units; everything above the SDK thinks in
    // probabilities.
    const prob = (raw: string | null | undefined): number | null =>
      raw === null || raw === undefined ? null : num(raw) / quoteUnit;

    const midRaw = top?.mid ?? m.lastPrice;
    const upPrice = midRaw !== null && midRaw !== undefined
      ? Math.min(0.99, Math.max(0.01, num(midRaw) / quoteUnit))
      : 0.5;

    // The window's opening price: the market's own strike when it has one,
    // otherwise the reference question's opening answer.
    const rawStrike = num(m.strike) || num(openingPrice);
    const scale = this.strikeScaleFor(m.marketId, m.asset, rawStrike);

    const state: MarketState = {
      marketId: m.marketId,
      // Gotcha §8.9 — typed fields, never the question text.
      symbol: m.asset,
      intervalSec: resolveIntervalSec(m) ?? num(m.intervalSec),
      // No scale means the feed has not reported yet and there is nothing to
      // divide by. Zero reads as "not known" everywhere above; a guess reads as
      // a price, and a wrong price here is the whole up/down question.
      strike: scale ? rawStrike / scale : 0,
      spot: this.underlying(m.asset),
      upPrice,
      status: toStatus(m.status, m.voided),
      openTime: num(m.tradingStart),
      expiryTime: num(m.expiry),
      upLiquid: Boolean(top?.bestAsk),
      downLiquid: Boolean(top?.bestBid),
      bestBid: prob(top?.bestBid),
      bestAsk: prob(top?.bestAsk),
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
