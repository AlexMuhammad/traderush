import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Account, WalletClient } from 'viem';
import { useWallet as useWalletSafe } from './walletContext';
import {
  MarketAdapter, DuelAdapter, RoomAdapter, loadConfig, type TradeRushConfig,
  type MarketState, type MarketSummary, type DuelView, type Room, type Seat,
} from '@traderush/sdk';

/** A price at `t` seconds after the window opened. */
export interface TrailPoint { t: number; price: number }

/** The trail's drawn width in user units. More samples than this cannot be
 *  told apart on screen, so past it they only add noise. */
const AXIS_COLUMNS = 380;

/** §3 — the front end NEVER talks to the chain or the socket directly. It talks to the SDK.
 *  This is non-negotiable: the game console is swapped in later against the same surface. */

interface Ctx {
  cfg: TradeRushConfig;
  market: MarketAdapter;
  duels: DuelAdapter | null;
  duelsError: string | null;
  rooms: RoomAdapter | null;
  roomsError: string | null;
}

const SdkCtx = createContext<Ctx | null>(null);

export function SdkProvider({ children }: { children: ReactNode }) {
  const value = useMemo<Ctx>(() => {
    const cfg = loadConfig(import.meta.env as unknown as Record<string, string | undefined>);
    const market = new MarketAdapter(cfg);
    let duels: DuelAdapter | null = null;
    let duelsError: string | null = null;
    try { duels = new DuelAdapter(cfg); }
    catch (e) { duelsError = e instanceof Error ? e.message : String(e); }

    let rooms: RoomAdapter | null = null;
    let roomsError: string | null = null;
    try { rooms = new RoomAdapter(cfg); }
    catch (e) { roomsError = e instanceof Error ? e.message : String(e); }

    return { cfg, market, duels, duelsError, rooms, roomsError };
  }, []);
  return <SdkCtx.Provider value={value}>{children}</SdkCtx.Provider>;
}

export function useSdk(): Ctx {
  const ctx = useContext(SdkCtx);
  if (!ctx) throw new Error('useSdk outside SdkProvider');
  return ctx;
}

/** S2 — the market table. Refreshes live off the same adapter every row watches. */
export function useMarkets(): { markets: MarketSummary[]; error: string | null; loading: boolean } {
  const { market } = useSdk();
  const [markets, setMarkets] = useState<MarketSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = () => market.listMarkets()
      .then((m) => { if (alive) { setMarkets(m); setError(null); } })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (alive) setLoading(false); });
    load();
    const t = setInterval(load, 5_000);
    return () => { alive = false; clearInterval(t); };
  }, [market]);

  return { markets, error, loading };
}

/** S3/S6 — live market state. watch() never throws; failures arrive as state.error. */
export function useMarket(marketId: string | null): MarketState | null {
  const { market } = useSdk();
  const [state, setState] = useState<MarketState | null>(null);
  useEffect(() => {
    setState(null);
    if (!marketId) return;
    return market.watch(marketId, setState);
  }, [market, marketId]);
  return state;
}

/**
 * The window's price shape, for any screen that asks someone to pick a side.
 *
 * Two sources, because neither covers a window alone: the tick tape reaches back
 * about three and a half minutes at full detail, and candles cover the rest of a
 * long window coarsely. Candles are fetched once per window and cached; the tape
 * is synchronous and re-read on every poll, so the right-hand edge stays live
 * while the body of the trail stays still.
 *
 * Ticks win wherever the two overlap — they are the finer record.
 */
export function useMarketTrail(state: MarketState | null): { points: TrailPoint[]; loading: boolean } {
  const { market } = useSdk();
  const symbol = state?.symbol ?? null;
  const from = state?.openTime ?? 0;
  const to = state?.expiryTime ?? 0;

  const [backfill, setBackfill] = useState<TrailPoint[] | null>(null);
  const [ticks, setTicks] = useState<TrailPoint[]>([]);

  useEffect(() => {
    setBackfill(null);
    if (!symbol || !to) return;
    let alive = true;
    // Bounded by now: asking for candles past the present returns nothing and
    // would otherwise make the cache key useless for the rest of the window.
    const end = Math.min(to, Math.floor(Date.now() / 1000));
    market.discovery.windowCandles(symbol, from, end)
      .then((rows) => { if (alive) setBackfill(rows); })
      .catch(() => { if (alive) setBackfill([]); });
    return () => { alive = false; };
  }, [market, symbol, from, to]);

  useEffect(() => {
    setTicks([]);
    if (!symbol || !to) return;
    const read = () => setTicks(market.discovery.priceHistory(symbol, from, to));
    read();
    const t = setInterval(read, 3_000);
    return () => clearInterval(t);
  }, [market, symbol, from, to]);

  const points = useMemo(() => {
    const by = new Map<number, number>();
    for (const p of backfill ?? []) by.set(p.t, p.price);
    for (const p of ticks) by.set(p.t, p.price);
    const merged = [...by.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([t, price]) => ({ t, price }));

    // On a day-long window the tape's two hundred ticks all land inside the last
    // three minutes — two pixels of a 380-wide axis, drawn as a noisy vertical
    // spike that reads as a price move that never happened. Bucketing to the
    // axis keeps one sample per column wherever the samples happen to cluster.
    const first = merged[0];
    const last = merged[merged.length - 1];
    if (!first || !last || merged.length <= AXIS_COLUMNS) return merged;
    const span = Math.max(1, last.t - first.t);
    const out: TrailPoint[] = [];
    let column = -1;
    for (const p of merged) {
      const c = Math.floor(((p.t - first.t) / span) * AXIS_COLUMNS);
      if (c === column) out[out.length - 1] = p;   // last price wins the column
      else { out.push(p); column = c; }
    }
    return out;
  }, [backfill, ticks]);

  return { points, loading: backfill === null && ticks.length === 0 };
}

/** S5/S6/S8 — polls duels(id) every 3s AND listens for Matched (§5.2). */
export function useDuel(duelId: bigint | null, adapter?: DuelAdapter | null): DuelView | null | undefined {
  const { duels } = useSdk();
  const a = adapter ?? duels;
  const [duel, setDuel] = useState<DuelView | null | undefined>(undefined);
  useEffect(() => {
    setDuel(undefined);
    if (!a || duelId === null) return;
    return a.watch(duelId, setDuel);
  }, [a, duelId]);
  return duel;
}

/** The escrow's allowance to spend collateral, and a one-press approve.
 *
 *  Both `open` and `accept` pull the stake with safeTransferFrom, so without an
 *  allowance they revert with ERC20InsufficientAllowance — a message that tells a
 *  first-time user nothing. This turns that into a visible step instead.
 */
export function useAllowance(owner: `0x${string}` | undefined, needed: bigint) {
  const { cfg, duels } = useSdk();
  const [allowance, setAllowance] = useState<bigint | null>(null);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const read = useCallback(() => {
    if (!duels || !owner) return;
    duels.allowance(cfg.addresses.collateral, owner)
      .then(setAllowance)
      .catch(() => setAllowance(null));
  }, [duels, owner, cfg.addresses.collateral]);

  useEffect(() => { read(); }, [read]);

  /**
   * Make sure the escrow can move `amount`, approving only if it cannot.
   *
   * Awaited immediately before the write it enables, rather than the screen
   * putting an Approve key in front of the real one. An approval is plumbing:
   * nobody decides it, it means nothing on its own, and a first-time player who
   * asked to open a duel and got a key labelled Approve has to work out where
   * their button went.
   *
   * The allowance is read fresh from the chain — React state can be one approval
   * behind, which either approves twice or skips one that was never granted.
   */
  const ensure = useCallback(async (wallet: WalletClient, account: Account, amount: bigint) => {
    if (!duels || !owner) return;
    const have = await duels.allowance(cfg.addresses.collateral, owner);
    if (have >= amount) return;
    setApproving(true); setError(null);
    try {
      // Approve far more than this stake so a player is asked once, not per duel.
      await duels.approve(wallet, account, cfg.addresses.collateral, 2n ** 255n);
      read();
    } finally { setApproving(false); }
  }, [duels, owner, cfg.addresses.collateral, read]);

  return {
    /** null while unknown — do not block the UI on it. */
    allowance,
    enough: allowance === null ? null : allowance >= needed,
    approving,
    error,
    ensure,
  };
}

/** One room, polled. Like duels, polling is the source of truth: nobody should
 *  be stranded in a lobby because a socket dropped at the wrong moment. */
export function useRoom(roomId: bigint | null): Room | null | undefined {
  const { rooms } = useSdk();
  const [room, setRoom] = useState<Room | null | undefined>(undefined);
  useEffect(() => {
    setRoom(undefined);
    if (!rooms || roomId === null) return;
    return rooms.watch(roomId, setRoom);
  }, [rooms, roomId]);
  return room;
}

/** What you put into a room and what you can take out. */
export function useSeat(roomId: bigint | null, room: Room | null | undefined): Seat | null {
  const { rooms } = useSdk();
  const { conn } = useWalletSafe();
  const [seat, setSeat] = useState<Seat | null>(null);
  const owner = conn?.account.address;

  useEffect(() => {
    if (!rooms || roomId === null || !owner) { setSeat(null); return; }
    let alive = true;
    rooms.seat(roomId, owner as `0x${string}`)
      .then((s) => { if (alive) setSeat(s); })
      .catch(() => { if (alive) setSeat(null); });
    return () => { alive = false; };
    // Re-read whenever the room's totals move: your share depends on them.
  }, [rooms, roomId, owner, room?.totalUp, room?.totalDown, room?.unwound]);

  return seat;
}

/** The wallet's collateral balance, refreshed. Gotcha §8.7 — read the WALLET,
 *  not the per-pool vault, which is a payout fallback and reads 0 in normal
 *  operation. */
export function useBalance(owner: `0x${string}` | undefined): bigint | null {
  const { market } = useSdk();
  const [balance, setBalance] = useState<bigint | null>(null);

  useEffect(() => {
    if (!owner) { setBalance(null); return; }
    let alive = true;
    const read = () => market.balance(owner)
      .then((b) => { if (alive) setBalance(b); })
      .catch(() => { if (alive) setBalance(null); });
    read();
    const t = setInterval(read, 10_000);
    return () => { alive = false; clearInterval(t); };
  }, [market, owner]);

  return balance;
}

/** A ticking wall clock, in seconds. One interval for every countdown on the page. */
export function useNow(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}
