import { useState } from 'react';
import { MIN_DEADLINE_MARGIN_SEC } from '@bullrun/sdk';
import { useMarket, useNow, useSdk } from '../../sdk';
import { useWallet } from '../../walletContext';
import { useMoney } from '../components/money';
import { Key } from '../components/Key';
import { SideIcon } from '../components/SideIcon';
import { Loading, Fault, Readout, TxLine } from '../components/Readout';
import { Trail } from '../components/Trail';
import { human, intervalLabel, price } from '../engine/market';
import { useRoomAllowance } from './useRoomAllowance';

/** Open a room on a market and take the first side. */
export function CreateRoomPanel({
  marketId, onOpened, onBack,
}: {
  marketId: `0x${string}`;
  onOpened: (roomId: bigint) => void;
  onBack: () => void;
}) {
  const state = useMarket(marketId);
  const { rooms, roomsError } = useSdk();
  const { conn, wrongChain } = useWallet();
  const money = useMoney();
  const now = useNow();

  const [side, setSide] = useState<'up' | 'down'>('up');
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

  const submit = () => {
    if (!conn) return;
    setPending(true); setError(null);
    rooms.open(conn.wallet, conn.account, marketId, side, stake, entryDeadline, state.expiryTime)
      .then(setOpened)
      .catch((e) => setError(e))
      .finally(() => setPending(false));
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

  return (
    <Readout title="Open a room" className="tight"
             right={`${state.symbol} · ${intervalLabel(state.intervalSec)}`}>
      {/* Picking a side off two numbers is picking blind — this is the shape
          those two numbers came out of. */}
      <Trail state={state} />

      {/* One instrument strip instead of three stacked rows: the same three
          numbers, read across in a glance rather than down a list. */}
      <div className="strip">
        <div>
          <span>strike</span>
          <b>{state.strike ? price(state.strike) : '—'}</b>
        </div>
        <div>
          <span>spot</span>
          <b className={state.spot >= state.strike ? 'up' : 'dn'}>
            {state.spot ? price(state.spot) : '—'}
          </b>
        </div>
        {/* Named as the BOOK's view, because a bare percentage on the side keys
            read like "52% of players picked UP" — and the room is empty. */}
        <div>
          <span>book</span>
          <b>
            <em className="up">{Math.round(state.upPrice * 100)}</em>
            {'/'}
            <em className="dn">{Math.round((1 - state.upPrice) * 100)}</em>
          </b>
        </div>
      </div>

      <div className="calls calls--slim">
        {(['up', 'down'] as const).map((sd) => (
          <Key key={sd} lit={side === sd} onPress={() => setSide(sd)}>
            <SideIcon side={sd} />
            <span className="nm">{sd.toUpperCase()}</span>
          </Key>
        ))}
      </div>

      {/* Stake and entry-close sit side by side: two settings, one band, so the
          form does not run the height of the screen. */}
      <div className="duo">
        <label className="field">
          <span>stake ({money.symbol})</span>
          <input value={stakeStr} onChange={(e) => setStakeStr(e.target.value)} inputMode="decimal" />
        </label>
        <label className="field">
          <span>entry closes</span>
          <div className="seg seg--slim">
            {[0.25, 0.5, 0.75].map((f) => {
              const ok = usable(f);
              const left = at(f) - now;
              return (
                <button
                  key={f}
                  className={chosen === f ? 'on' : undefined}
                  disabled={!ok}
                  onClick={() => setFraction(f)}
                  title={ok ? `${left}s from now` : 'already past, or too close to expiry'}
                >
                  {Math.round(f * 100)}%
                </button>
              );
            })}
          </div>
        </label>
      </div>

      {/* The two things that actually change what happens, on one line each.
          The reasoning behind them is a fold — it is worth reading once, not
          on every visit. */}
      {roomFits ? (
        <>
          <p className="hint">
            <span>entry shuts in</span> <b>{human(Math.max(0, entryDeadline - now))}</b>
            <i />
            <span>payout</span> <b className="warn">floats with the split</b>
          </p>
          <details className="fold">
            <summary>why these two matter</summary>
            <p>
              Closing entry early stops a late joiner watching most of the window play
              out and then taking the short side with almost nothing at risk.
            </p>
            <p>
              Nobody has joined yet, so there is no split and no multiple — those appear
              once people back a side. The winning side splits the whole pot by stake,
              so the more that piles onto your side, the less each takes.
            </p>
          </details>
        </>
      ) : (
        <p className="note err">
          This window closes in {human(remaining)} — too short for a room. People need time
          to join, and the escrow refuses an entry deadline inside the last
          {' '}{MIN_DEADLINE_MARGIN_SEC}s. Pick a longer market.
        </p>
      )}

      {/* The commit pair, laid out the way a handheld lays them out: two round
          caps set on a diagonal, each named by the strip underneath rather than
          by text crammed into the cap. A round key cannot grow into a banner,
          which is the whole point — the panel above it stays the screen. */}
      <div className="pad">
        <div className="pad__slot">
          <Key className="round round--b" onPress={onBack}>B</Key>
          <span className="pad__lab">back</span>
        </div>
        <div className="pad__slot pad__slot--a">
          {allow.enough === false ? (
            <>
              <Key className="round round--a" disabled={allow.approving}
                   onPress={() => conn && void allow.approve(conn.wallet, conn.account)}>A</Key>
              <span className="pad__lab on">
                {allow.approving ? 'approving…' : `approve ${money.symbol}`}
              </span>
            </>
          ) : (
            <>
              <Key className="round round--a" disabled={!ready} onPress={submit}>A</Key>
              <span className="pad__lab on">{pending ? 'opening…' : 'open the room'}</span>
            </>
          )}
        </div>
      </div>

      {allow.enough === false ? (
        <p className="hint">The escrow needs permission to move your stake. Asked once.</p>
      ) : null}
      {error ? <Fault error={error} /> : null}
      {allow.error ? <Fault error={allow.error} /> : null}
    </Readout>
  );
}
