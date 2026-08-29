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
  const [marginSec, setMarginSec] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<{ roomId: bigint; txHash: string; link: string } | null>(null);

  let stake = 0n;
  try { stake = money.parse(stakeStr || '0'); } catch { /* surfaced below */ }
  const allow = useRoomAllowance(stake);

  if (!state) return <Readout title="Open a room"><Loading label="reading the market" /></Readout>;
  if (!rooms) return <Readout title="Open a room"><p className="note err">{roomsError}</p></Readout>;

  // Short windows are real — the venue runs 60s markets. A fixed margin would
  // put the deadline before now, which the escrow rejects outright.
  const remaining = Math.max(0, state.expiryTime - now);
  const maxMargin = Math.max(0, remaining - 10);
  const roomFits = maxMargin >= MIN_DEADLINE_MARGIN_SEC;
  const margin = Math.min(marginSec ?? 60, maxMargin);
  const entryDeadline = state.expiryTime ? state.expiryTime - margin : 0;
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
        <span>entry closes — seconds before expiry (min {MIN_DEADLINE_MARGIN_SEC}, max {maxMargin})</span>
        <input type="number" min={MIN_DEADLINE_MARGIN_SEC} max={maxMargin} value={margin}
               onChange={(e) => setMarginSec(Number(e.target.value))} />
      </label>

      {!roomFits && (
        <p className="note err">
          This window closes in {remaining}s — too short. People need time to join, and
          the escrow refuses an entry deadline inside the last {MIN_DEADLINE_MARGIN_SEC}s.
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
