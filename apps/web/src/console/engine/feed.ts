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

  constructor(
    private readonly adapter: MarketAdapter,
    private readonly pollMs = 3_000,
  ) {}

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

  /** Two intervals per asset, shortest first, in the tuner's order. */
  private pick(all: { marketId: string; symbol: string; intervalSec: number; strike: number;
                      spot: number; upPrice: number; openTime: number; expiryTime: number;
                      status: string }[]): FeedSlot[] {
    const out: FeedSlot[] = [];
    for (const asset of ['BTC', 'ETH'] as const) {
      const mine = all
        .filter((m) => m.symbol.toUpperCase().includes(asset) && m.status === 'Trading')
        .sort((a, b) => a.intervalSec - b.intervalSec);

      // Distinct intervals, so the two dials are not the same window twice.
      const seen = new Set<number>();
      const chosen = mine.filter((m) => !seen.has(m.intervalSec) && seen.add(m.intervalSec)).slice(0, 2);
      for (const m of chosen) {
        out.push({
          marketId: m.marketId,
          symbol: asset,
          intervalSec: m.intervalSec,
          strike: m.strike,
          spot: m.spot,
          upP: m.upPrice,
          openTime: m.openTime,
          expiryTime: m.expiryTime,
          status: m.status as FeedSlot['status'],
        });
      }
      // Keep the grid rectangular even when an asset offers only one interval.
      while (out.length % 2 !== 0 && chosen.length) out.push({ ...out[out.length - 1]! });
    }
    return out;
  }
}

/** Labels for the tuner when no live market has arrived yet. */
export const FALLBACK_LABELS = MARKETS.map((m) => ({ asset: m.asset, interval: m.interval }));
