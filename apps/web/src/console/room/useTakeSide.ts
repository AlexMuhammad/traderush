import { useEffect, useRef, useState } from 'react';
import { useBalance, useMarket, useSdk } from '../../sdk';
import { useWallet } from '../../walletContext';
import { useEngine } from '../engineContext';
import { useMoney } from '../components/money';
import { useBookTop } from '../useBookTop';

/**
 * Where a stake is written down, keyed by the exact position it paid for.
 *
 * Per market AND per side: holding both legs is possible, and they were not
 * bought for the same money.
 */
const stakeKey = (marketId: string, side: 'up' | 'down') => `traderush.stake.${marketId}.${side}`;

/** Storage throws in a private window and in some embedded views, and a stake
 *  that cannot be written is not worth failing a purchase over. Every path here
 *  degrades to the behaviour this had before it was written down at all. */
function readStake(marketId: string | undefined, side: 'up' | 'down' | null): number | null {
  if (!marketId || !side) return null;
  try {
    const raw = localStorage.getItem(stakeKey(marketId, side));
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch { return null; }
}

function writeStake(marketId: string | undefined, side: 'up' | 'down', v: number): void {
  if (!marketId) return;
  try { localStorage.setItem(stakeKey(marketId, side), String(v)); } catch { /* not worth a failed buy */ }
}

function clearStake(marketId: string | undefined, side: 'up' | 'down' | null): void {
  if (!marketId || !side) return;
  try { localStorage.removeItem(stakeKey(marketId, side)); } catch { /* nothing to undo */ }
}

/**
 * How long a lit key stays armed before it forgets.
 *
 * The arm exists so that money is never one stray tap away, and it has to
 * expire: a key left lit is a key that will eventually be pressed by accident.
 *
 * It was four seconds, and four seconds is not long enough to read what the key
 * now says and decide. Past it the second press does not commit — it re-arms,
 * silently, and the key looks exactly as it did before. Reported as "I keep
 * pressing and nothing happens", which is precisely what it does.
 *
 * Fifteen still forgets, and forgets long before anyone has walked away.
 */
const ARM_LAPSE_MS = 15_000;

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
  /**
   * What was paid for the current holding.
   *
   * The chain knows what the position is WORTH — the outcome tokens are right
   * there — and nothing on it knows what it COST. Only the buyer does, and only
   * at the moment of buying.
   *
   * It used to be a ref, which meant a reload lost it, and losing it costs more
   * than a missing number: the settlement card is built from stake and payout,
   * so without the stake there was no card, and a window you were in ended on a
   * bare word. Refreshing the page is not a thing that should quieten a result.
   *
   * So it is written down, per market and per side, and read back on the way
   * in. Storage is per browser and per origin — the honest limit is that a
   * position bought somewhere else still has no cost here, and the card falls
   * back to the plain result rather than inventing one.
   */
  const [spent, setSpent] = useState<number | null>(null);
  const [pending, setPending] = useState<'up' | 'down' | null>(null);
  const [error, setError] = useState<unknown>(null);

  let amount = 0n;
  try { amount = money.parse(amountStr || '0'); } catch { /* surfaced as a blocker */ }
  /*
   * No allowance step here, deliberately.
   *
   * This used to call `useRoomAllowance(amount).ensure(...)` before every buy —
   * and that hook approves the ROOM ESCROW. The console's UP/DOWN keys do not
   * go anywhere near the room escrow: they buy on the book through the pool.
   * So it was asking for a signature that granted a spender this trade never
   * uses, in front of the trade, every time the allowance read came back short.
   * The comment that used to sit here said "different spender", which is the
   * bug written down.
   *
   * The spender that IS needed is handled a layer down and better: the markets
   * SDK's writer approves `maxUint256` once per (token, spender), caches the
   * pair, and does the same for the ERC-6909 operator grant the outcome tokens
   * need. So the allowance is already infinite and already once-per-wallet —
   * there was nothing here to add but a prompt.
   */

  const scale = 10n ** BigInt(money.decimals);

  /**
   * Running on the demo's paper market rather than the chain.
   *
   * Everything below that talks to a chain — the wallet, the allowance, the
   * book, the expiry the indexer reports — has nothing to talk to here. So the
   * demo takes its own short path: an amount, a window still open, and a side.
   * It is skipped rather than faked, and it can never reach `take()`.
   */
  const paper = engine ? !engine.live : false;

  /**
   * What a taker actually pays for one contract of a side, in raw units.
   *
   * The far side of the book, never the mid. Buying UP lifts the ask; buying
   * DOWN is selling YES, so it costs one minus the bid.
   */
  const costRaw = (side: 'up' | 'down'): bigint | null => {
    // The demo has no book to lift. Its price is the implied probability the
    // keys already show, which is also what `takePaper` charges — so what the
    // returns line promises is exactly what the settlement card pays back.
    if (paper) {
      const q = engine ? (side === 'up' ? engine.race.upP : 1 - engine.race.upP) : 0;
      if (!(q > 0.01) || !(q < 0.99)) return null;
      return BigInt(Math.round(q * Number(scale)));
    }
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

  /** A side nobody is offering cannot be bought at any price. The demo always
   *  quotes both, because its price IS the implied probability rather than
   *  somebody's resting order. */
  const liquid = (side: 'up' | 'down') => paper || costRaw(side) !== null;

  /**
   * Whether the book has been READ yet — which is not the same as whether it
   * holds anything.
   *
   * `useBookTop` starts at null and stays there until the first eth_call lands,
   * so `liquid` is false for a moment on every window before it is false for a
   * reason. A key that says "no offer" during that moment is making the same
   * kind of claim as one that offers a price nobody is quoting; it just happens
   * to be wrong in the other direction. Callers that render the difference ask
   * this first.
   */
  const bookKnown = paper || top !== null;

  // The engine draws whatever the wallet is holding. One place decides it, and
  // it is the chain.
  // In the demo the position is the paper one, and the pad has to read it from
  // there: `useHeldSide` asks the chain, and there is no chain here.
  const paperPos = paper && engine ? engine.race.pos : null;
  const heldSide: 'up' | 'down' | null = paper ? (paperPos?.side ?? null) : holding.side;
  const heldTokens = paper
    ? (paperPos ? money.parse(paperPos.n.toFixed(money.decimals)) : 0n)
    : holding.held
      ? (holding.side === 'up' ? holding.held.up : holding.side === 'down' ? holding.held.down : 0n)
      : 0n;

  /**
   * Past its own expiry, read fresh every time it is asked.
   *
   * `status` comes from the indexer, and the indexer lags the chain by seconds
   * — long enough that the console can be sitting on WAITING FOR NEXT WINDOW at
   * 00:00 while the status still says Trading. A press in that gap is signed,
   * paid for, sent, and then reverted by the contract with
   * `OrderAlreadyExpired()`: a failed transaction for a window the screen had
   * already announced was over.
   *
   * The expiry does not lag. It is a fixed timestamp the market was opened
   * with, so it can be compared against the clock without asking anyone.
   *
   * A function rather than a value because the second one is read at the moment
   * of the press, where a stale render must not be able to let an order
   * through.
   */
  const pastExpiry = () =>
    !!state && state.expiryTime > 0 && Date.now() >= state.expiryTime * 1000;

  /** A closed window has no book to sell into; what is owed is redeemed on the
   *  Positions screen instead.
   *
   *  The demo answers from its own clock. Asking the indexer would always say
   *  no here — there is no market row to have a status — and the pad reads that
   *  as a shut window: it hides the sell-back key and offers Positions instead,
   *  which in a demo leads nowhere. */
  const tradeable = paper ? (engine?.canTakePaper ?? false)
                          : (state?.status === 'Trading' && !pastExpiry());

  const short = balance !== null && amount > balance;
  const blocker = paper
    ? (amount === 0n ? 'enter an amount'
      : !engine!.canTakePaper ? 'this window is not trading'
      : null)
    : !conn ? 'sign in to take a side'
    : wrongChain ? 'wrong network'
    : amount === 0n ? 'enter an amount'
    : short ? `insufficient balance — you have ${money.format(balance!)}`
    // Before the status check, and worded differently on purpose: this one is
    // the window running out, which is a thing that just happened to you, not a
    // market that was never open.
    : pastExpiry() ? 'this window has closed'
    : state?.status !== 'Trading' ? 'this window is not trading'
    : !liquid('up') && !liquid('down') ? 'no orders on this book yet'
    : null;

  const ready = blocker === null && pending === null;


  // An arm cannot outlive the window it was made on.
  useEffect(() => { disarm(); }, [marketId]);

  // Read the stake back for whatever is held here now. A different market or a
  // different side is a different purchase, so this is the only place the value
  // is allowed to arrive from storage.
  useEffect(() => {
    setSpent(readStake(marketId, holding.side));
  }, [marketId, holding.side]);

  useEffect(() => {
    if (!engine) return;
    // The demo sets its own side in `takePaper` and clears it in `exitPaper`.
    // Left unguarded this ran with a chain-shaped `holding` that is always
    // empty here, and cleared the side out from under the paper position.
    if (paper) return;
    if (!holding.side) { engine.setWatchSide(null); return; }
    engine.setWatchSide(holding.side, spent === null ? null : {
      stake: spent,
      payoutIfWon: Number(money.plain(heldTokens)),
    });
  }, [engine, paper, holding.side, heldTokens, money, spent]);

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
    if (paper) {
      const v = engine?.paperExit ?? null;
      return v === null ? null : money.parse(v.toFixed(money.decimals));
    }
    if (!top || !holding.side || heldTokens === 0n || !tradeable) return null;
    // Selling UP hits the bid; selling DOWN is buying YES, so it lifts the ask
    // and the position is worth one minus it.
    const px = holding.side === 'up' ? top.bid : (top.ask === null ? null : scale - top.ask);
    if (px === null || px <= 0n || px >= scale) return null;
    return (heldTokens * px) / scale;
  })();

  const exit = async () => {
    if (paper) { engine?.exitPaper(); return undefined; }
    if (!conn || !state || !holding.side || heldTokens === 0n || pending || !tradeable) return;
    setPending(holding.side); setError(null);
    try {
      const sold = await market.sell(state.marketId as `0x${string}`, holding.side, heldTokens);
      if (sold.proceeds === 0n) throw new Error('nothing crossed — no bid at that size');
      holding.refresh();
      // The position is gone, so what it cost is no longer about anything.
      clearStake(marketId, holding.side);
      setSpent(null);
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
      // Live keys forget; the demo's do not. Nothing here can be spent, so
      // there is nothing to protect against, and a deadline of any length is
      // just another way for a press to land after the arm has gone.
      if (!paper) armTimer.current = setTimeout(() => setArmed(null), ARM_LAPSE_MS);
      return;
    }
    disarm();
    if (paper) { engine!.takePaper(side, Number(money.plain(amount))); return; }
    return take(side);
  };

  const take = async (side: 'up' | 'down') => {
    // A confirm press that cannot go through has to SAY so. This used to return
    // silently on any of these, which from the outside is indistinguishable
    // from a dead button — the key stayed lit, nothing moved, and there was
    // nothing on the glass to explain it.
    if (!conn) { setError(new Error('sign in to take a side')); return; }
    if (!state) { setError(new Error('still reading this window — try again in a moment')); return; }
    if (!liquid(side)) { setError(new Error(`no offer on ${side} right now`)); return; }
    if (!ready) return;   // a blocker is already on the glass saying why
    // Asked again here, against the clock rather than against the last render.
    // `ready` was decided whenever React last ran, and a window can expire
    // between that frame and this finger — which is exactly the case the
    // contract answers with OrderAlreadyExpired(). Said as a sentence, because
    // a revert reads as a fault and this is not one.
    if (pastExpiry()) { setError(new Error('this window has closed')); return; }
    setPending(side); setError(null);
    try {
      const pos = await market.buy(state.marketId as `0x${string}`, side, amount);
      // Immediate-or-cancel: a thin book can cross less than was asked for, and
      // an order that crossed nothing is not a position.
      if (pos.size === 0n) throw new Error('nothing crossed — the book had no offer at that price');

      // The scene follows the holdings, and they have just changed. Asking the
      // chain rather than asserting it here is what makes the position survive a
      // window rolling, a dial being tuned, and a reload.
      holding.refresh();
      const paid = Number(money.plain(amount));
      writeStake(marketId, side, paid);
      setSpent(paid);
      return pos;
    } catch (e) { setError(e); return undefined; }
    finally { setPending(null); }
  };

  return {
    amountStr, setAmountStr, amount, balance, blocker, ready, pending, error,
    returns, liquid, bookKnown, press, armed, exit, exitAt, tradeable, held: heldTokens, heldSide,
    symbol: money.symbol, format: money.format,
  };
}
