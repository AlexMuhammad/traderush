import { useState } from 'react';
import { MIN_DEADLINE_MARGIN_SEC } from '@traderush/sdk';
import { useMarket, useNow, useSdk } from '../../sdk';
import { useWallet } from '../../walletContext';
import { useMoney } from '../components/money';
import { Key } from '../components/Key';
import { SideIcon } from '../components/SideIcon';
import { Loading, Fault, Readout, TxLine } from '../components/Readout';
import { MatchScreen } from '../components/MatchScreen';
import { human, intervalLabel, price } from '../engine/market';
import { useRoomAllowance } from './useRoomAllowance';

/** Open a room on a market and take the first side. */
export function CreateRoomPanel({
  marketId, onOpened, onBack, initialSide = 'up',
}: {
  marketId: `0x${string}`;
  onOpened: (roomId: bigint) => void;
  onBack: () => void;
  /** The side already chosen on the way in, from the call keys. */
  initialSide?: 'up' | 'down';
}) {
  const state = useMarket(marketId);
  const { rooms, roomsError } = useSdk();
  const { conn, wrongChain } = useWallet();
  const money = useMoney();
  const now = useNow();

  const [side, setSide] = useState<'up' | 'down'>(initialSide);
  const [stakeStr, setStakeStr] = useState('1');
  /** How far into the window entry closes. Expressed as a FRACTION rather than
   *  seconds-before-expiry: the thing worth controlling is how much of the
   *  window a late joiner gets to watch before committing, and that is a
   *  proportion, not a countdown. */
  const [fraction, setFraction] = useState(0.5);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [opened, setOpened] = useState<{ roomId: bigint; txHash: string; link: string } | null>(null);

  let stake = 0n;
  try { stake = money.parse(stakeStr || '0'); } catch { /* surfaced below */ }
  const allow = useRoomAllowance(stake);

  if (!state) return <Readout title="Open a room"><Loading label="reading the market" /></Readout>;
  if (!rooms) return <Readout title="Open a room"><p className="note err">{roomsError}</p></Readout>;

  // Entry closing early is what stops someone waiting until the window has
  // almost played out, seeing the split, and taking the underdog side with
  // nearly no exposure — the same claim on the pot as whoever went first.
  const remaining = Math.max(0, state.expiryTime - now);
  const at = (f: number) => Math.floor(state.openTime + state.intervalSec * f);
  // Needs to be far enough ahead that someone can actually join, and far enough
  // before expiry that the escrow's own margin is satisfied.
  const usable = (f: number) =>
    at(f) > now + 15 && at(f) + MIN_DEADLINE_MARGIN_SEC <= state.expiryTime;

  const choices = [0.25, 0.5, 0.75].filter(usable);
  const chosen = choices.includes(fraction) ? fraction : choices[choices.length - 1];
  const roomFits = choices.length > 0 && chosen !== undefined;
  const entryDeadline = chosen !== undefined ? at(chosen) : 0;
  const ready = Boolean(conn) && !wrongChain && stake > 0n && roomFits
    && state.status === 'Trading' && !pending;

  // One press, two transactions when the wallet has never approved before. The
  // approval is not a decision anybody makes, so it does not get its own key —
  // it happens on the way to the thing that was actually asked for, and the
  // label says which half is running.
  const submit = async () => {
    if (!conn) return;
    setPending(true); setError(null);
    try {
      await allow.ensure(conn.wallet, conn.account, stake);
      setOpened(await rooms.open(
        conn.wallet, conn.account, marketId, side, stake, entryDeadline, state.expiryTime,
      ));
    } catch (e) { setError(e); }
    finally { setPending(false); }
  };

  if (opened) {
    const url = `${window.location.origin}${opened.link}`;
    return (
      <Readout title={`Room #${opened.roomId}`} right="open">
        <TxLine hash={opened.txHash} />
        <p className="note">
          Anyone with this can join, either side, any size — until entry closes.
        </p>
        <div className="linkline">
          <code>{url}</code>
          <button onClick={() => void navigator.clipboard.writeText(url)}>copy</button>
        </div>
        <Key className="action" onPress={() => onOpened(opened.roomId)}>To the room</Key>
      </Readout>
    );
  }

  const upPct = Math.round(state.upPrice * 100);
  const sides = [
    { side: 'up' as const, name: 'UP' },
    { side: 'down' as const, name: 'DOWN' },
  ];
  // A window with no resting orders still reports a price: the mid falls back to
  // the last trade, and then to a flat 0.5. On screen that is indistinguishable
  // from a market that genuinely thinks it is a coin flip, and someone will pick
  // a side off it. Say which one it is.
  const unpriced = !state.upLiquid && !state.downLiquid;
  const trend = state.spot >= state.strike ? 'up' : 'dn';
  // How much of the window is already gone. It is the reason an option is not
  // available, so it belongs on screen rather than behind a disabled attribute.
  const runPct = Math.max(0, Math.min(100,
    ((now - state.openTime) / Math.max(1, state.intervalSec)) * 100));

  // Built from the game face's own parts rather than from a readout panel: the
  // question strip, the dark window, the call keys, the steel order tray. A duel
  // screen that invents its own furniture reads as a second front end bolted to
  // the same shell — which is exactly what this is not.
  return (
    <>
      <div className="window">
        <div className="crt">
          {/* The live scene, not a picture of one — and it answers the key you
              are hovering: press DOWN and the bull is the one that comes for
              you. That is the thing being bought, so it should be running
              before the money is. */}
          <MatchScreen state={state} side={side} />
        </div>
        <div className="readout">
          <span className={`px ${trend}`}>{state.spot ? price(state.spot) : '—'}</span>
          <span className={`dl ${trend}`}>
            {state.spot >= state.strike ? '+' : ''}{(state.spot - state.strike).toFixed(2)}
          </span>
          <span>strike {state.strike ? price(state.strike) : '—'}</span>
        </div>
      </div>

      {/* Just the two words. On the game face these keys carry the book's price
          because there the book IS the counterparty — that number is what you
          would pay. In a room it decides nothing: your payout comes from who
          joins. A percentage printed on the key you press reads as your odds,
          and it is not. It moves to the tray below, where the screen's other
          small facts live and it can be labelled for what it is. */}
      <div className="calls calls--pick">
        {sides.map((k) => (
          <Key key={k.side} lit={side === k.side} onPress={() => setSide(k.side)}>
            <SideIcon side={k.side} />
            <span className="nm">{k.name}</span>
          </Key>
        ))}
      </div>

      <div className="order">
        <label className="field field--inline">
          <span>stake ({money.symbol})</span>
          <input value={stakeStr} onChange={(e) => setStakeStr(e.target.value)} inputMode="decimal" />
        </label>

        {/* The window itself, with the door on it.
            Three keys made a fraction of a window look like three unrelated
            options, and hid the one fact that decides which are even available:
            how much of the window has already run. Here that is the dim stretch
            behind the pins — a 25% pin sitting inside it is visibly in the past,
            rather than mysteriously refusing to be pressed. */}
        <label className="field">
          <span>entry closes at</span>
          <div className="bar">
            <div className="bar__track">
              {/* Fill first, hatch over it. They overlap — time that has passed
                  is still inside the entry period — and drawing the hatch second
                  is what lets you see both at once. The other way round, a 75%
                  door on a half-run window painted the whole bar amber and the
                  elapsed stretch vanished. */}
              <i className="bar__fill" style={{ width: `${(chosen ?? 0) * 100}%` }} />
              <i className="bar__run" style={{ width: `${runPct}%` }} />
              {[0.25, 0.5, 0.75].map((f) => {
                const ok = usable(f);
                const left = at(f) - now;
                return (
                  <button
                    key={f}
                    type="button"
                    className={`bar__pin${chosen === f ? ' on' : ''}`}
                    style={{ left: `${f * 100}%` }}
                    disabled={!ok}
                    onClick={() => setFraction(f)}
                    title={ok ? `${left}s from now` : 'already past, or too close to expiry'}
                  >
                    <b>{Math.round(f * 100)}%</b>
                  </button>
                );
              })}
            </div>
            <div className="bar__ends">
              <span>open</span>
              <span>expiry</span>
            </div>
          </div>
        </label>

        <div className="calc">
          <span>book thinks</span>
          {/* A window with no resting orders still reports a price: the mid
              falls back to the last trade, then to a flat 0.5. On screen that is
              indistinguishable from a market that genuinely thinks it is a coin
              flip, and it decides nothing here either way. Say which one it is. */}
          <span>{unpriced ? 'no orders yet' : `${upPct} up / ${100 - upPct} down`}</span>
        </div>

        {roomFits ? (
          <div className="calc">
            <span>entry shuts in</span>
            <span>{human(Math.max(0, entryDeadline - now))}</span>
          </div>
        ) : (
          <div className="calc calc--bad">
            <span>too short</span>
            <span>needs {MIN_DEADLINE_MARGIN_SEC}s clear of expiry</span>
          </div>
        )}
      </div>

      <details className="fold">
        <summary>how a room pays</summary>
        <p>
          Closing entry early stops a late joiner watching most of the window play out
          and then taking the short side with almost nothing at risk.
        </p>
        <p>
          Payouts float: the winning side splits the whole pot by stake, so the more
          that piles onto your side, the less each takes. Nobody has joined yet, so
          there is no split and no multiple until they do.
        </p>
      </details>

      {/* The same shape as the call keys above, because it is the same kind of
          choice: two options, equal weight, side by side. The round pad set them
          on a diagonal at two different sizes, which said one of them was an
          afterthought — and it ended the screen on a shape that appears nowhere
          else on the machine. Lit is the commit; the way out is plain steel, the
          way it is everywhere else here. */}
      <div className="calls calls--act">
        <Key onPress={onBack}>
          <span className="nm">back</span>
        </Key>
        <Key lit={ready} disabled={!ready} onPress={() => void submit()}>
          <span className="nm">
            {allow.approving ? 'approving…' : pending ? 'opening…' : 'open the room'}
          </span>
        </Key>
      </div>

      {allow.enough === false ? (
        <p className="hint">First room on this wallet signs twice: permission, then the room.</p>
      ) : null}
      {error ? <Fault error={error} /> : null}
    </>
  );
}
