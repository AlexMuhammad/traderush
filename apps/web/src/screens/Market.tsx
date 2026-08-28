import { useState } from 'react';
import { parseUnits } from 'viem';
import { useMarket, useSdk } from '../sdk';
import { StatusBadge, Countdown, StaleWrapper, TxState, useFrozen, OracleLink } from '../components/ui';
import { useWallet } from '../App';

/** S3 — one market. Two actions: trade on the book (solo), or create a duel. */
export function Market({ marketId, navigate }: { marketId: `0x${string}`; navigate: (to: string) => void }) {
  const state = useMarket(marketId);
  const { market } = useSdk();
  const { conn, wrongChain } = useWallet();
  const frozen = useFrozen(state?.expiryTime ?? 0);

  const [cost, setCost] = useState('1');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);

  if (!state) return <p className="muted">loading market…</p>;

  const down = state.upPrice ? 1 - state.upPrice : 0;
  const delta = state.strike ? state.spot - state.strike : 0;
  const canWrite = Boolean(conn) && !wrongChain && state.status === 'Trading' && !frozen;

  const trade = (side: 'up' | 'down') => {
    setPending(true); setError(null); setHash(null);
    // The SDK re-checks on-chain status before writing (gotcha §8.1) and snaps the
    // price and size to the grid (§8.2, §8.3) — the screen never does arithmetic.
    market.buy(marketId, side, parseUnits(cost || '0', 18))
      .then((p) => setHash(p.txHash))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setPending(false));
  };

  return (
    <section>
      <p><a href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>← markets</a></p>
      <h2>{state.symbol} · {state.intervalSec}s <StatusBadge status={state.status} /></h2>

      <StaleWrapper state={state}>
        <dl>
          <dt>marketId</dt><dd><code>{state.marketId}</code></dd>
          <dt>strike</dt><dd>{state.strike || '—'} <span className="muted">(window opening price)</span></dd>
          <dt>spot</dt><dd>{state.spot || '—'}</dd>
          <dt>delta</dt>
          <dd className={delta >= 0 ? 'ok' : 'err'}>{delta >= 0 ? '+' : ''}{delta.toFixed(4)}</dd>
          <dt>up</dt>
          <dd>{state.upPrice.toFixed(3)} <span className="muted">×{state.upPrice ? (1 / state.upPrice).toFixed(2) : '—'}</span>{!state.upLiquid && <span className="warn"> · illiquid</span>}</dd>
          <dt>down</dt>
          <dd>{down.toFixed(3)} <span className="muted">×{down ? (1 / down).toFixed(2) : '—'}</span>{!state.downLiquid && <span className="warn"> · illiquid</span>}</dd>
          <dt>expiry</dt><dd><Countdown to={state.expiryTime} /></dd>
          <dt>oracle</dt><dd><OracleLink questionId={state.oracleQuestionId} /></dd>
        </dl>
      </StaleWrapper>

      <div className="panel">
        <h3>Trade on book (solo)</h3>
        <label>
          <span>cost — this is also your maximum loss</span>
          <input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" />
        </label>
        <p className="muted">Max loss: {cost || '0'} USDso. Builder fees apply to book orders.</p>
        <div className="row">
          <button disabled={!canWrite || pending} onClick={() => trade('up')}>Buy UP</button>
          <button disabled={!canWrite || pending} onClick={() => trade('down')}>Buy DOWN</button>
        </div>
        {/* §6.2 — disabled a few seconds before expiry, not at zero. */}
        {frozen && <p className="warn">too close to expiry — writes are disabled (§8.11)</p>}
        {state.status !== 'Trading' && <p className="warn">market is {state.status}; only Trading accepts orders</p>}
        <TxState pending={pending} error={error} hash={hash} />
      </div>

      <div className="panel">
        <h3>Create duel</h3>
        <p className="muted">
          No order book, no market maker, no liquidity requirement. Two people stake equally;
          the winner takes the pot.
        </p>
        <button disabled={!canWrite} onClick={() => navigate(`/market/${marketId}/duel`)}>
          Create duel →
        </button>
      </div>
    </section>
  );
}
