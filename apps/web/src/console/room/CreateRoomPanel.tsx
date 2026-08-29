import { useState } from 'react';
import { MIN_DEADLINE_MARGIN_SEC } from '@bullrun/sdk';
import { useMarket, useNow, useSdk } from '../../sdk';
import { useWallet } from '../../walletContext';
import { useMoney } from '../components/money';
import { Key } from '../components/Key';
import { SideIcon } from '../components/SideIcon';
import { Loading, Readout, Row, Rows, TxLine } from '../components/Readout';
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
  const [error, setError] = useState<string | null>(null);
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
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
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
    <Readout title="Open a room" right={`${state.symbol} · ${state.intervalSec}s`}>
      <Rows>
        <Row label="strike">{state.strike || '—'}</Row>
        <Row label="spot" tone={state.spot >= state.strike ? 'up' : 'dn'}>{state.spot || '—'}</Row>
      </Rows>

      <div className="calls" style={{ marginTop: 11 }}>
        {(['up', 'down'] as const).map((sd) => (
          <Key key={sd} lit={side === sd} onPress={() => setSide(sd)}>
            <SideIcon side={sd} />
            <span className="nm">{sd.toUpperCase()}</span>
            <span className="pct">{Math.round((sd === 'up' ? state.upPrice : 1 - state.upPrice) * 100)}%</span>
          </Key>
        ))}
      </div>

      <label className="field">
        <span>your stake ({money.symbol})</span>
        <input value={stakeStr} onChange={(e) => setStakeStr(e.target.value)} inputMode="decimal" />
      </label>

      <label className="field">
        <span>entry closes at</span>
        <div className="seg" style={{ height: 34 }}>
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

      {roomFits ? (
        <p className="note">
          A quarter of the way in, half, or three quarters. Closing earlier means a
          late joiner cannot watch most of the window play out and then take the
          short side with almost nothing at risk.
          {' '}Entry shuts in {Math.max(0, entryDeadline - now)}s.
        </p>
      ) : (
        <p className="note err">
          This window closes in {remaining}s — too short for a room. People need time
          to join, and the escrow refuses an entry deadline inside the last
          {' '}{MIN_DEADLINE_MARGIN_SEC}s. Pick a longer market.
        </p>
      )}

      {/* The one thing a room changes about the promise. Better said here than
          discovered when the payout is not the 2x someone expected. */}
      <p className="note warn">
        Payouts float. The winning side splits the whole pot by stake, so the more
        that piles onto your side, the less each of you takes.
      </p>

      {allow.enough === false ? (
        <>
          <Key className="action" disabled={allow.approving}
               onPress={() => conn && void allow.approve(conn.wallet, conn.account)}>
            {allow.approving ? 'approving…' : `Approve ${money.symbol}`}
          </Key>
          <p className="note">The escrow needs permission to move your stake. Asked once.</p>
        </>
      ) : (
        <Key className="action" disabled={!ready} onPress={submit}>
          {pending ? 'pending…' : 'Open the room'}
        </Key>
      )}

      {error && <p className="note err">{error}</p>}
      {allow.error && <p className="note err">{allow.error}</p>}
      <Key className="action" onPress={onBack}>Back</Key>
    </Readout>
  );
}
