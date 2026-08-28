import { useState } from 'react';
import { formatUnits, parseUnits } from 'viem';
import { defaultAcceptDeadline, MIN_DEADLINE_MARGIN_SEC } from '@bullrun/sdk';
import { useMarket, useSdk } from '../sdk';
import { StatusBadge, TxState, CopyButton, useFrozen } from '../components/ui';
import { useWallet } from '../App';

/** S4 — Create duel. Side, stake, computed pot and payout, accept deadline. */
export function CreateDuel({ marketId, navigate }: { marketId: `0x${string}`; navigate: (to: string) => void }) {
  const state = useMarket(marketId);
  const { duels, cfg } = useSdk();
  const { conn, wrongChain } = useWallet();
  const frozen = useFrozen(state?.expiryTime ?? 0);

  const [side, setSide] = useState<'up' | 'down'>('up');
  const [stakeStr, setStakeStr] = useState('1');
  const [marginSec, setMarginSec] = useState(60); // §6.1 S4 default: expiry − 60s
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ duelId: bigint; txHash: string; link: string } | null>(null);

  if (!state) return <p className="muted">loading market…</p>;
  if (!duels) return <p className="err">DUEL_ESCROW_ADDRESS is not set — deploy DuelEscrow first (M3).</p>;

  let stake = 0n;
  try { stake = parseUnits(stakeStr || '0', 18); } catch { /* shown below */ }
  const pot = stake * 2n;
  const acceptDeadline = state.expiryTime ? state.expiryTime - marginSec : 0;
  const deadlineOk = marginSec >= MIN_DEADLINE_MARGIN_SEC;
  const canSubmit = Boolean(conn) && !wrongChain && stake > 0n && deadlineOk && !frozen
    && state.status === 'Trading' && !pending;

  const submit = () => {
    if (!conn) return;
    setPending(true); setError(null);
    duels.open(conn.wallet, conn.account, marketId, side, stake, acceptDeadline, state.expiryTime)
      .then(setResult)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setPending(false));
  };

  if (result) {
    const url = `${window.location.origin}${result.link}`;
    return (
      <section>
        <h2>Duel #{String(result.duelId)} opened</h2>
        <TxState pending={false} error={null} hash={result.txHash} />
        <p>Send this link to your opponent:</p>
        <div className="row">
          <code>{url}</code><CopyButton text={url} />
        </div>
        <p className="muted">
          The link carries no secrets — every term lives on-chain and is read from
          <code> duels({String(result.duelId)})</code>.
        </p>
        <button onClick={() => navigate(`/duel/${result.duelId}`)}>Go to lobby →</button>
      </section>
    );
  }

  return (
    <section>
      <p><a href={`/market/${marketId}`} onClick={(e) => { e.preventDefault(); navigate(`/market/${marketId}`); }}>← market</a></p>
      <h2>Create duel · {state.symbol} <StatusBadge status={state.status} /></h2>

      <label>
        <span>your side</span>
        <select value={side} onChange={(e) => setSide(e.target.value as 'up' | 'down')}>
          <option value="up">UP — spot above strike at expiry</option>
          <option value="down">DOWN — spot below strike at expiry</option>
        </select>
      </label>

      <label>
        <span>stake per side (USDso)</span>
        <input value={stakeStr} onChange={(e) => setStakeStr(e.target.value)} inputMode="decimal" />
      </label>

      <label>
        <span>accept deadline — seconds before expiry (minimum {MIN_DEADLINE_MARGIN_SEC})</span>
        <input type="number" min={MIN_DEADLINE_MARGIN_SEC} value={marginSec}
               onChange={(e) => setMarginSec(Number(e.target.value))} />
      </label>
      {!deadlineOk && (
        // Gotcha §8.11 — accepting into a locking market reverts inside mintCompleteSet
        // and burns gas for both parties.
        <p className="err">
          must be at least {MIN_DEADLINE_MARGIN_SEC}s before expiry, otherwise the accept
          lands in a locking market and reverts for both parties
        </p>
      )}

      <div className="panel">
        <dl>
          <dt>your stake</dt><dd>{formatUnits(stake, 18)} USDso</dd>
          <dt>opponent stake</dt><dd>{formatUnits(stake, 18)} USDso</dd>
          <dt>pot</dt><dd>{formatUnits(pot, 18)} USDso</dd>
          <dt>payout if you win</dt><dd className="ok">{formatUnits(pot, 18)} USDso (×2)</dd>
          <dt>max loss</dt><dd className="err">{formatUnits(stake, 18)} USDso</dd>
          <dt>accept deadline</dt>
          <dd>{acceptDeadline ? new Date(acceptDeadline * 1000).toLocaleTimeString() : '—'}</dd>
        </dl>
        <p className="muted">
          Nothing is minted until someone accepts. If nobody does, cancel refunds your stake
          exactly. No builder fee applies to duels.
        </p>
      </div>

      <button onClick={submit} disabled={!canSubmit}>
        {pending ? 'pending…' : 'Open duel'}
      </button>
      {frozen && <p className="warn">too close to expiry — writes are disabled</p>}
      <TxState pending={pending} error={error} hash={null} />
      <p className="muted">escrow {cfg.escrowAddress}</p>
    </section>
  );
}
