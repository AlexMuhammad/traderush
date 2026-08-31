import { useState } from 'react';
import { MIN_DEADLINE_MARGIN_SEC } from '@traderush/sdk';
import { useAllowance, useMarket, useNow, useSdk } from '../../sdk';
import { useWallet } from '../../walletContext';
import { useMoney } from '../components/money';
import { Key } from '../components/Key';
import { SideIcon } from '../components/SideIcon';
import { Loading, Fault, Readout, Row, Rows, TxLine } from '../components/Readout';
import { MatchScreen } from '../components/MatchScreen';
import { intervalLabel, price } from '../engine/market';

/** Stake a side and publish a challenge. The console's S4. */
export function CreateDuelPanel({
  marketId, onOpened, onBack,
}: {
  marketId: `0x${string}`;
  onOpened: (duelId: bigint) => void;
  onBack: () => void;
}) {
  const state = useMarket(marketId);
  const { duels } = useSdk();
  const { conn, wrongChain } = useWallet();
  const money = useMoney();
  const now = useNow();

  const [side, setSide] = useState<'up' | 'down'>('up');
  const [stakeStr, setStakeStr] = useState('1');
  const [marginSec, setMarginSec] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [opened, setOpened] = useState<{ duelId: bigint; txHash: string; link: string } | null>(null);

  let stake = 0n;
  try { stake = money.parse(stakeStr || '0'); } catch { /* surfaced below */ }
  const allow = useAllowance(conn?.account.address as `0x${string}` | undefined, stake);

  if (!state) return <Readout title="Create duel"><Loading label="reading the market" /></Readout>;
  if (!duels) return <Readout title="Create duel"><p className="note err">No escrow deployed on this network.</p></Readout>;

  const pot = stake * 2n;

  // Short windows are real: the venue runs 60s and 300s markets alongside the
  // hour-long ones. A fixed 60s margin puts the deadline BEFORE now on a 60s
  // window, and the escrow rejects that as DeadlineInPast — so the margin is
  // bounded by what the window can actually hold.
  const remaining = Math.max(0, state.expiryTime - now);
  const maxMargin = Math.max(0, remaining - 10);
  const roomForDuel = maxMargin >= MIN_DEADLINE_MARGIN_SEC;
  const margin = Math.min(marginSec ?? 60, maxMargin);
  const acceptDeadline = state.expiryTime ? state.expiryTime - margin : 0;
  const deadlineOk = roomForDuel && margin >= MIN_DEADLINE_MARGIN_SEC;
  const ready = Boolean(conn) && !wrongChain && stake > 0n && deadlineOk
    && state.status === 'Trading' && !pending;

  // One press, two signatures the first time. Same reasoning as the room
  // screens: an approval is not a decision anybody makes.
  const submit = async () => {
    if (!conn) return;
    setPending(true); setError(null);
    try {
      await allow.ensure(conn.wallet, conn.account, stake);
      setOpened(await duels.open(
        conn.wallet, conn.account, marketId, side, stake, acceptDeadline, state.expiryTime,
      ));
    } catch (e) { setError(e); }
    finally { setPending(false); }
  };

  if (opened) {
    const url = `${window.location.origin}${opened.link}`;
    return (
      <Readout title={`Duel #${opened.duelId}`} right="open">
        <TxLine hash={opened.txHash} />
        <p className="note">Send this to your opponent. Every term lives on-chain — the link carries no secrets.</p>
        <div className="linkline">
          <code>{url}</code>
          <button onClick={() => void navigator.clipboard.writeText(url)}>copy</button>
        </div>
        <Key className="action" onPress={() => onOpened(opened.duelId)}>To the lobby</Key>
      </Readout>
    );
  }

  const trend = state.spot >= state.strike ? 'up' : 'dn';

  // The game face's own parts, same as the room screens. A duel is the same
  // window being watched by two people with money on it.
  return (
    <>
      <div className="q">
        <span className="exp">{intervalLabel(state.intervalSec)}</span>
        Challenge one person on <b>{state.symbol}</b>. Equal stakes, winner takes the pot.
      </div>

      <div className="window">
        <div className="crt">
          {/* Live, and it answers the key you are hovering: take DOWN and the
              bull is the one that comes for you. */}
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

      {/* A duel pays a flat 2x whatever the book says, so the keys carry the
          multiple and nothing else. The book's opinion is a fact for the tray. */}
      <div className="calls calls--pick">
        {(['up', 'down'] as const).map((sd) => (
          <Key key={sd} lit={side === sd} onPress={() => setSide(sd)}>
            <SideIcon side={sd} />
            <span className="nm">{sd.toUpperCase()}</span>
          </Key>
        ))}
      </div>

      <div className="order">
        <label className="field field--inline">
          <span>stake each ({money.symbol})</span>
          <input value={stakeStr} onChange={(e) => setStakeStr(e.target.value)} inputMode="decimal" />
        </label>
        <label className="field field--inline">
          <span>accept window (s)</span>
          <input type="number" min={MIN_DEADLINE_MARGIN_SEC} max={maxMargin} value={margin}
                 onChange={(e) => setMarginSec(Number(e.target.value))} />
        </label>

        <div className="calc">
          <span>book thinks</span>
          <span>{Math.round(state.upPrice * 100)} up / {Math.round((1 - state.upPrice) * 100)} down</span>
        </div>
        <div className="calc">
          <span>pot · you win</span>
          <span className="lamp">{money.format(pot)} · ×2</span>
        </div>
        <div className="calc">
          <span>max loss</span>
          <span className="dn">{money.format(stake)}</span>
        </div>
        {!roomForDuel ? (
          // Gotcha §8.11 — the escrow enforces the 30s margin too, but a window
          // this short can never satisfy it, so say so instead of letting them try.
          <div className="calc calc--bad">
            <span>too short</span>
            <span>closes in {remaining}s — pick a longer market</span>
          </div>
        ) : !deadlineOk && (
          <div className="calc calc--bad">
            <span>deadline</span>
            <span>inside the last {MIN_DEADLINE_MARGIN_SEC}s reverts for both</span>
          </div>
        )}
      </div>

      <p className="hint">
        Nothing is minted until someone accepts — unmatched, cancel refunds you exactly.
        No builder fee applies to duels.
      </p>

      <div className="calls calls--act">
        <Key onPress={onBack}><span className="nm">back</span></Key>
        <Key lit={ready} disabled={!ready} onPress={() => void submit()}>
          <span className="nm">
            {allow.approving ? 'approving…' : pending ? 'opening…' : 'open duel'}
          </span>
        </Key>
      </div>

      {error ? <Fault error={error} /> : null}
      {allow.error ? <Fault error={allow.error} /> : null}
    </>
  );
}
