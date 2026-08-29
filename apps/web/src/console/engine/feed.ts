import type { MarketAdapter } from '@bullrun/sdk';
import type { FeedSlot, MarketFeed } from './types';
import { MARKETS } from './market';

/**
 * The console's four dials, backed by real event contracts.
 *
 * The venue runs more markets than the console has slots, so this picks a 2×2
 * that matches the tuner: each asset, at its two shortest live intervals. Short
 * windows first because a console you watch for two minutes should resolve
 * inside those two minutes.
 *
 * Slot order is [BTC-short, BTC-long, ETH-short, ETH-long], matching MARKETS.
 */
export class LiveFeed implements MarketFeed {
  readonly live = true;
  private readonly listeners = new Set<(slots: FeedSlot[]) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private slots: FeedSlot[] = [];
  /** `BTC:60` … Chosen once, then held. See `pick`. */
  private series: string[] = [];

  constructor(
    private readonly adapter: MarketAdapter,
    private readonly pollMs = 3_000,
  ) {}

  /** The whole window, from candles. Cached in the SDK per window. */
  backfill(slot: FeedSlot): Promise<{ t: number; price: number }[]> {
    return this.adapter.discovery.windowCandles(slot.symbol, slot.openTime, slot.expiryTime);
  }

  subscribe(onSlots: (slots: FeedSlot[]) => void): () => void {
    this.listeners.add(onSlots);
    if (this.slots.length) onSlots(this.slots);
    this.start();
    return () => {
      this.listeners.delete(onSlots);
      if (this.listeners.size === 0) this.stop();
    };
  }

  private start(): void {
    if (this.timer) return;
    const tick = async () => {
      try {
        const live = await this.adapter.listMarkets();
        const next = this.pick(live);
        if (next.length) {
          this.slots = next;
          for (const l of this.listeners) l(next);
        }
      } catch {
        // A failed poll is not a reason to blank the console; the last good
        // reading stays on screen and the next tick tries again.
      }
    };
    void tick();
    this.timer = setInterval(() => void tick(), this.pollMs);
  }

  private stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Four dials, each locked to a SERIES — an asset at an interval, like
   * `BTC:60` — rather than to a position in a filtered list.
   *
   * That distinction is the whole point. A series rolls every window: the old
   * market leaves the live list and a new marketId takes its place. If the
   * dials were positional, that roll would reshuffle which series each dial
   * pointed at, the engine would read four changed marketIds instead of one,
   * and it would wipe the trail and the scene on every roll — a display that
   * comes and goes for no reason a viewer can see.
   *
   * Locked to a series, a roll is exactly what it is: one window ending and the
   * next beginning on the same dial. And a series briefly absent from the list
   * holds its last reading rather than dragging another series into its place.
   */
  private pick(all: { marketId: string; symbol: string; intervalSec: number; strike: number;
                      spot: number; upPrice: number; openTime: number; expiryTime: number;
                      status: string }[]): FeedSlot[] {
    const trading = all.filter((m) => m.status === 'Trading');
    const key = (asset: string, iv: number) => `${asset}:${iv}`;
    const byKey = new Map<string, typeof trading[number]>();
    for (const m of trading) {
      const asset = m.symbol.toUpperCase().includes('BTC') ? 'BTC'
                  : m.symbol.toUpperCase().includes('ETH') ? 'ETH' : m.symbol.toUpperCase();
      const k = key(asset, m.intervalSec);
      // Soonest to expire wins: that is the window currently running.
      const held = byKey.get(k);
      if (!held || m.expiryTime < held.expiryTime) byKey.set(k, m);
    }

    if (!this.series.length) {
      // First sight only: EVERY live interval for each asset, shortest first.
      // Taking two hid three of the five the venue runs — a dial that cannot
      // reach most of the markets is worse than no dial.
      for (const asset of ['BTC', 'ETH'] as const) {
        const intervals = [...new Set(
          trading
            .filter((m) => m.symbol.toUpperCase().includes(asset))
            .map((m) => m.intervalSec),
        )].sort((a, b) => a - b);
        for (const iv of intervals) this.series.push(key(asset, iv));
      }
    }

    const out: FeedSlot[] = [];
    this.series.forEach((k, i) => {
      const m = byKey.get(k);
      if (m) {
        const [asset] = k.split(':');
        out.push({
          marketId: m.marketId,
          symbol: asset!,
          intervalSec: m.intervalSec,
          strike: m.strike,
          spot: m.spot,
          upP: m.upPrice,
          openTime: m.openTime,
          expiryTime: m.expiryTime,
          status: m.status as FeedSlot['status'],
          // What the underlying actually did inside this window. Free to ask —
          // the tape is already in memory and the read is synchronous.
          history: this.adapter.discovery.priceHistory(
            asset!, m.openTime, Math.floor(Date.now() / 1000),
          ),
        });
        return;
      }
      // Between windows, or an indexer hiccup. Hold the dial rather than
      // reshuffling every other one around it.
      const previous = this.slots[i];
      if (previous) out.push(previous);
    });
    return out;
  }
}

/** Labels for the tuner when no live market has arrived yet. */
export const FALLBACK_LABELS = MARKETS.map((m) => ({ asset: m.asset, interval: m.interval }));
