import { useEffect, useRef, useState } from 'react';
import { useBalance, useMarket, useSdk } from '../../sdk';
import { useWallet } from '../../walletContext';
import { useEngine } from '../engineContext';
import { useMoney } from '../components/money';
import { useRoomAllowance } from './useRoomAllowance';

/**
 * Taking a side on the run: the amount, what it would return, and the one press
 * that places the order.
 *
 * This is the front page's own feature and it is NOT a room. Here you trade the
 * event contract against the book — the market is your counterparty, the fill is
 * immediate, and nobody has to turn up. Rooms and duels are the other thing: a
 * pot against other people, and they live in the menu.
 *
 * The order is the point. An amount first, because it decides whether either
 * side is affordable and what each would return; then the side, because by then
 * the consequence is on screen; and the side key IS the write, because a key
 * that only arms something is a key that did nothing.
 */
export function useTakeSide(
  marketId: string | undefined,
  /** What this wallet actually holds on this window — the position itself,
   *  rather than a memory of having bought one. See useHeldSide. */
  holding: { side: 'up' | 'down' | null; held: { up: bigint; down: bigint } | null; refresh: () => void },
) {
  const { market } = useSdk();
  const { conn, wrongChain } = useWallet();
  const engine = useEngine();
  const state = useMarket((marketId ?? null) as `0x${string}` | null);
  const money = useMoney();
  const balance = useBalance(conn?.account.address as `0x${string}` | undefined);

  const [amountStr, setAmountStr] = useState('1');
  /** What was paid for the current holding, when this session is the one that
   *  paid it. A reload cannot know it, and the settlement card says so by
   *  showing the plain result rather than inventing a cost. */
  const spent = useRef<number | null>(null);
  const [pending, setPending] = useState<'up' | 'down' | null>(null);
  const [error, setError] = useState<unknown>(null);

  let amount = 0n;
  try { amount = money.parse(amountStr || '0'); } catch { /* surfaced as a blocker */ }
  // The pool escrows the collateral, so it needs the allowance — same shape as
  // the escrows, different spender.
  const allow = useRoomAllowance(amount);

  /**
   * What a taker actually pays for one contract of a side.
   *
   * The far side of the book, never the mid. Buying UP lifts the ask; buying
   * DOWN is selling YES, so it hits the bid and costs 1 minus it. On a book
   * quoting 11.6 / 13.9 those are two and a half points apart, and quoting the
   * mid would promise a return nobody is offering.
   */
  const cost = (side: 'up' | 'down'): number | null => {
    if (!state) return null;
    const p = side === 'up' ? state.bestAsk : (state.bestBid === null ? null : 1 - state.bestBid);
    return p !== null && p > 0 && p < 1 ? p : null;
  };

  /**
   * What this amount comes back as if the side wins.
   *
   * One contract pays 1 collateral. Spending `amount` at price `p` buys
   * `amount / p` contracts, so a win returns `amount / p` — which is also why a
   * cheap side pays more: you are buying more of them.
   */
  const returns = (side: 'up' | 'down'): bigint | null => {
    const p = cost(side);
    if (p === null || amount === 0n) return null;
    return BigInt(Math.floor(Number(amount) / p));
  };

  /** A side nobody is offering cannot be bought at any price. */
  const liquid = (side: 'up' | 'down') => cost(side) !== null;

  // Declared before the blockers read it — `liquid` closes over `cost`, which
  // needs the state the blockers are also checking.
  const liquidAt = (side: 'up' | 'down') => {
    if (!state) return false;
    const p = side === 'up' ? state.bestAsk : (state.bestBid === null ? null : 1 - state.bestBid);
    return p !== null && p > 0 && p < 1;
  };

  const short = balance !== null && amount > balance;
  const blocker = !conn ? 'sign in to take a side'
    : wrongChain ? 'wrong network'
    : amount === 0n ? 'enter an amount'
    : short ? `insufficient balance — you have ${money.format(balance!)}`
    : state?.status !== 'Trading' ? 'this window is not trading'
    : !liquidAt('up') && !liquidAt('down') ? 'no orders on this book yet'
    : null;

  const ready = blocker === null && pending === null;

  // The engine draws whatever the wallet is holding. One place decides it, and
  // it is the chain.
  const heldTokens = holding.held
    ? (holding.side === 'up' ? holding.held.up : holding.side === 'down' ? holding.held.down : 0n)
    : 0n;
  useEffect(() => {
    if (!engine) return;
    if (!holding.side) { spent.current = null; engine.setWatchSide(null); return; }
    engine.setWatchSide(holding.side, spent.current === null ? null : {
      stake: spent.current,
      payoutIfWon: Number(money.plain(heldTokens)),
    });
  }, [engine, holding.side, heldTokens, money]);

  const take = async (side: 'up' | 'down') => {
    if (!ready || !conn || !state || !liquid(side)) return;
    setPending(side); setError(null);
    try {
      await allow.ensure(conn.wallet, conn.account, amount);
      const pos = await market.buy(state.marketId as `0x${string}`, side, amount);
      // Immediate-or-cancel: a thin book can cross less than was asked for, and
      // an order that crossed nothing is not a position.
      if (pos.size === 0n) throw new Error('nothing crossed — the book had no offer at that price');

      // The scene follows the holdings, and they have just changed. Asking the
      // chain rather than asserting it here is what makes the position survive a
      // window rolling, a dial being tuned, and a reload.
      holding.refresh();
      spent.current = Number(money.plain(amount));
      return pos;
    } catch (e) { setError(e); return undefined; }
    finally { setPending(null); }
  };

  return {
    amountStr, setAmountStr, amount, balance, blocker, ready, pending, error,
    returns, cost, liquid, take, approving: allow.approving,
    symbol: money.symbol, format: money.format,
  };
}
