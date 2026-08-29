import { useState } from 'react';
import { MIN_DEADLINE_MARGIN_SEC } from '@bullrun/sdk';
import { useAllowance, useMarket, useSdk } from '../../sdk';
import { useWallet } from '../../walletContext';
import { useMoney } from '../components/money';
import { Key } from '../components/Key';
import { Readout, Row, Rows, TxLine } from '../components/Readout';

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

  const [side, setSide] = useState<'up' | 'down'>('up');
  const [stakeStr, setStakeStr] = useState('1');
  const [marginSec, setMarginSec] = useState(60);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<{ duelId: bigint; txHash: string; link: string } | null>(null);

  let stake = 0n;
  try { stake = money.parse(stakeStr || '0'); } catch { /* surfaced below */ }
  const allow = useAllowance(conn?.account.address as `0x${string}` | undefined, stake);

  if (!state) return <Readout title="Create duel"><p className="note">reading the market…</p></Readout>;
  if (!duels) return <Readout title="Create duel"><p className="note err">No escrow deployed on this network.</p></Readout>;

  const pot = stake * 2n;
  const acceptDeadline = state.expiryTime ? state.expiryTime - marginSec : 0;
  const deadlineOk = marginSec >= MIN_DEADLINE_MARGIN_SEC;
  const ready = Boolean(conn) && !wrongChain && stake > 0n && deadlineOk
    && state.status === 'Trading' && !pending;

  const submit = () => {
    if (!conn) return;
    setPending(true); setError(null);
    duels.open(conn.wallet, conn.account, marketId, side, stake, acceptDeadline, state.expiryTime)
      .then(setOpened)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setPending(false));
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

  return (
    <Readout title="Create duel" right={`${state.symbol} · ${state.intervalSec}s`}>
      <Rows>
        <Row label="strike">{state.strike || '—'}</Row>
        <Row label="spot" tone={state.spot >= state.strike ? 'up' : 'dn'}>{state.spot || '—'}</Row>
      </Rows>

      {/* Side is a pair of lit keys, the same control as the game's call keys. */}
      <div className="calls" style={{ marginTop: 11 }}>
        {(['up', 'down'] as const).map((s) => (
          <Key key={s} lit={side === s} onPress={() => setSide(s)}>
            <span className="beast">{s === 'up' ? '🐂' : '🐻'}</span>
            <span className="nm">{s.toUpperCase()}</span>
            <span className="pct">{Math.round((s === 'up' ? state.upPrice : 1 - state.upPrice) * 100)}%</span>
          </Key>
        ))}
      </div>

      <label className="field">
        <span>stake per side ({money.symbol})</span>
        <input value={stakeStr} onChange={(e) => setStakeStr(e.target.value)} inputMode="decimal" />
      </label>

      <label className="field">
        <span>accept deadline — seconds before expiry (min {MIN_DEADLINE_MARGIN_SEC})</span>
        <input type="number" min={MIN_DEADLINE_MARGIN_SEC} value={marginSec}
               onChange={(e) => setMarginSec(Number(e.target.value))} />
      </label>
      {!deadlineOk && (
        // Gotcha §8.11 — the escrow enforces this too, but failing here costs nothing.
        <p className="note err">
          Accepting inside the last {MIN_DEADLINE_MARGIN_SEC}s reverts for both parties.
        </p>
      )}

      <Rows>
        <Row label="pot" tone="lamp">{money.format(pot)}</Row>
        <Row label="you win" tone="up">{money.format(pot)} (×2)</Row>
        <Row label="max loss" tone="dn">{money.format(stake)}</Row>
      </Rows>

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
          {pending ? 'pending…' : 'Open duel'}
        </Key>
      )}

      {error && <p className="note err">{error}</p>}
      {allow.error && <p className="note err">{allow.error}</p>}
      <p className="note">
        Nothing is minted until someone accepts. Unmatched, cancel refunds you exactly.
        No builder fee applies to duels.
      </p>
      <Key className="action" onPress={onBack}>Back</Key>
    </Readout>
  );
}
