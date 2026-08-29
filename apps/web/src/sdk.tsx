import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Account, WalletClient } from 'viem';
import {
  MarketAdapter, DuelAdapter, loadConfig, type BullrunConfig,
  type MarketState, type MarketSummary, type DuelView,
} from '@bullrun/sdk';

/** §3 — the front end NEVER talks to the chain or the socket directly. It talks to the SDK.
 *  This is non-negotiable: the game console is swapped in later against the same surface. */

interface Ctx {
  cfg: BullrunConfig;
  market: MarketAdapter;
  duels: DuelAdapter | null;
  duelsError: string | null;
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
    return { cfg, market, duels, duelsError };
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

  const approve = async (wallet: WalletClient, account: Account) => {
    if (!duels) return;
    setApproving(true); setError(null);
    try {
      // Approve far more than this stake so a player is asked once, not per duel.
      await duels.approve(wallet, account, cfg.addresses.collateral, 2n ** 255n);
      read();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setApproving(false); }
  };

  return {
    /** null while unknown — do not block the UI on it. */
    allowance,
    enough: allowance === null ? null : allowance >= needed,
    approving,
    error,
    approve,
  };
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
