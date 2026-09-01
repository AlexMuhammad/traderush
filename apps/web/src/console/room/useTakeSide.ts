import { useEffect, useRef, useState } from 'react';
import { useBalance, useMarket, useSdk } from '../../sdk';
import { useWallet } from '../../walletContext';
import { useEngine } from '../engineContext';
import { useMoney } from '../components/money';
import { useRoomAllowance } from './useRoomAllowance';
import { useBookTop } from '../useBookTop';

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
  // Every price below comes from the pool, not the indexer — see useBookTop.
  const top = useBookTop(marketId);

  const [amountStr, setAmountStrRaw] = useState('1');
  /**
   * The side a first tap has armed, if any.
   *
   * A single tap used to place the order. With an injected wallet the signature
   * prompt is a brake; with an embedded one there is none, so on that path there
   * was nothing at all between a finger and the money — beside a key of the same
   * size that means the opposite thing.
   *
   * So the first tap arms and says what it is about to do, and the second does
   * it. Same key, so the finger does not move; the number is simply read once
   * more at the moment it starts to matter.
   */
  const [armed, setArmed] = useState<'up' | 'down' | null>(null);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const scale = 10n ** BigInt(money.decimals);

  /**
   * What a taker actually pays for one contract of a side, in raw units.
   *
   * The far side of the book, never the mid. Buying UP lifts the ask; buying
   * DOWN is selling YES, so it costs one minus the bid.
   */
  const costRaw = (side: 'up' | 'down'): bigint | null => {
    if (!top) return null;
    const p = side === 'up' ? top.ask : (top.bid === null ? null : scale - top.bid);
    return p !== null && p > 0n && p < scale ? p : null;
  };

  /**
   * What this amount comes back as if the side wins.
   *
   * One contract pays 1 collateral. Spending `amount` at price `p` buys
   * `amount / p` contracts, so a win returns `amount / p` — which is also why a
   * cheap side pays more: you are buying more of them.
   */
  const returns = (side: 'up' | 'down'): bigint | null => {
    const p = costRaw(side);
    if (p === null || amount === 0n) return null;
    // One contract pays one collateral, so a budget buys budget/price of them —
    // all in raw units, no float on a number anyone acts on.
    return (amount * scale) / p;
  };

  /** A side nobody is offering cannot be bought at any price. */
  const liquid = (side: 'up' | 'down') => costRaw(side) !== null;

  // The engine draws whatever the wallet is holding. One place decides it, and
  // it is the chain.
  const heldTokens = holding.held
    ? (holding.side === 'up' ? holding.held.up : holding.side === 'down' ? holding.held.down : 0n)
    : 0n;

  /** A closed window has no book to sell into; what is owed is redeemed on the
   *  Positions screen instead. */
  const tradeable = state?.status === 'Trading';

  const short = balance !== null && amount > balance;
  const blocker = !conn ? 'sign in to take a side'
    : wrongChain ? 'wrong network'
    : amount === 0n ? 'enter an amount'
    : short ? `insufficient balance — you have ${money.format(balance!)}`
    : state?.status !== 'Trading' ? 'this window is not trading'
    : !liquid('up') && !liquid('down') ? 'no orders on this book yet'
    : null;

  const ready = blocker === null && pending === null;


  // An arm cannot outlive the window it was made on.
  useEffect(() => { disarm(); }, [marketId]);

  useEffect(() => {
    if (!engine) return;
    if (!holding.side) { spent.current = null; engine.setWatchSide(null); return; }
    engine.setWatchSide(holding.side, spent.current === null ? null : {
      stake: spent.current,
      payoutIfWon: Number(money.plain(heldTokens)),
    });
  }, [engine, holding.side, heldTokens, money]);

  /**
   * Sell the position back to the book before the window closes.
   *
   * The venue supports it — "you can sell back at the live price any time while
   * the window is open" — and the SDK has since the start; there was simply no
   * way to ask. What comes back is whatever the resting bids pay, which is less
   * than the position is notionally worth, because the spread is the cost of
   * changing your mind.
   */
  /** What the resting bids would pay for the whole holding, right now. */
  const exitAt: bigint | null = (() => {
    if (!top || !holding.side || heldTokens === 0n || !tradeable) return null;
    // Selling UP hits the bid; selling DOWN is buying YES, so it lifts the ask
    // and the position is worth one minus it.
    const px = holding.side === 'up' ? top.bid : (top.ask === null ? null : scale - top.ask);
    if (px === null || px <= 0n || px >= scale) return null;
    return (heldTokens * px) / scale;
  })();

  const exit = async () => {
    if (!conn || !state || !holding.side || heldTokens === 0n || pending || !tradeable) return;
    setPending(holding.side); setError(null);
    try {
      const sold = await market.sell(state.marketId as `0x${string}`, holding.side, heldTokens);
      if (sold.proceeds === 0n) throw new Error('nothing crossed — no bid at that size');
      holding.refresh();
      spent.current = null;
      return sold;
    } catch (e) { setError(e); return undefined; }
    finally { setPending(null); }
  };

  const disarm = () => {
    if (armTimer.current) clearTimeout(armTimer.current);
    armTimer.current = null;
    setArmed(null);
  };

  /** Changing the amount un-arms: the number on the key is no longer the number
   *  that was agreed to. */
  const setAmountStr = (v: string) => { disarm(); setAmountStrRaw(v); };

  /**
   * One press to arm, a second to commit.
   *
   * Arming the other side moves the arm rather than stacking a second one, and
   * an arm nobody confirms lapses — a key left lit is a key that will eventually
   * be pressed by accident.
   */
  const press = async (side: 'up' | 'down') => {
    if (!ready || !liquid(side)) return;
    if (armed !== side) {
      if (armTimer.current) clearTimeout(armTimer.current);
      setArmed(side);
      armTimer.current = setTimeout(() => setArmed(null), 4_000);
      return;
    }
    disarm();
    return take(side);
  };

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
    returns, liquid, press, armed, exit, exitAt, tradeable, held: heldTokens, heldSide: holding.side,
    approving: allow.approving,
    symbol: money.symbol, format: money.format,
  };
}
