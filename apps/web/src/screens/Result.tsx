import { useEffect, useState } from 'react';
import { formatUnits } from 'viem';
import { binaryMarketsModuleAbi, outcomeToken6909Abi } from '@bullrun/sdk';
import { useDuel, useMarket, useSdk } from '../sdk';
import { OracleLink, TxState } from '../components/ui';
import { useWallet } from '../App';

/** S7 — Result. Winner, amount, redeem if not auto-redeemed, oracle link.
 *  Voided renders as "called off — both sides refunded 0.5", NEVER as a loss (§8.10). */
export function Result({ duelId }: { duelId: bigint }) {
  const duel = useDuel(duelId);
  const market = useMarket(duel?.marketId ?? null);
  const { market: adapter } = useSdk();
  const { conn } = useWallet();

  const [held, setHeld] = useState<bigint | null>(null);
  const [myId, setMyId] = useState<bigint | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);

  const settled = market?.status === 'Resolved' || market?.status === 'Voided';

  useEffect(() => {
    if (!duel || !market || !settled || !conn) return;
    let alive = true;
    void (async () => {
      try {
        const venue = await adapter.addresses();
        const ids = await adapter.publicClient.readContract({
          address: venue.module, abi: binaryMarketsModuleAbi,
          functionName: 'outcomeIds', args: [duel.marketId],
        }) as readonly [bigint, bigint];
        const me = conn.account.address.toLowerCase();
        const iAmChallenger = me === duel.challenger.toLowerCase();
        const iAmUp = iAmChallenger ? duel.challengerUp : !duel.challengerUp;
        const id = iAmUp ? ids[0] : ids[1];
        const bal = await adapter.publicClient.readContract({
          address: venue.outcomeToken, abi: outcomeToken6909Abi,
          functionName: 'balanceOf', args: [conn.account.address, id],
        });
        if (alive) { setMyId(id); setHeld(bal); }
      } catch (e) { if (alive) setError(e instanceof Error ? e.message : String(e)); }
    })();
    return () => { alive = false; };
  }, [duel, market, settled, conn, adapter]);

  if (!duel || duel.status !== 'Matched' || !market || !settled) return null;

  const voided = market.status === 'Voided';
  const upWon = market.spot > market.strike;
  const challengerWon = duel.challengerUp === upWon;
  const winner = challengerWon ? duel.challenger : duel.opponent;
  const me = conn?.account.address.toLowerCase();
  const iWon = me === winner.toLowerCase();

  const redeem = async () => {
    if (!conn || myId === null || held === null || held === 0n) return;
    setPending(true); setError(null);
    try {
      const venue = await adapter.addresses();
      // The loser's leg redeems 0 and must not revert (§11), so this is safe to press
      // on either side.
      const { request } = await adapter.publicClient.simulateContract({
        account: conn.account, address: venue.module, abi: binaryMarketsModuleAbi,
        functionName: 'redeem', args: [duel.marketId, myId, held],
      });
      const tx = await conn.wallet.writeContract(request);
      await adapter.publicClient.waitForTransactionReceipt({ hash: tx });
      setHash(tx);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setPending(false); }
  };

  return (
    <section>
      <h2>Duel #{String(duelId)} · {voided ? 'called off' : 'settled'}</h2>

      {voided ? (
        // §8.10 / §11 — a void is not a loss.
        <div className="panel">
          <p className="warn">
            Called off. The market was voided, so both sides redeem 0.5 per contract —
            each of you gets your {formatUnits(duel.stake, 18)} USDso stake back. Nobody lost.
          </p>
        </div>
      ) : (
        <dl>
          <dt>winner</dt>
          <dd><code>{winner}</code> {iWon && <span className="ok">— that is you</span>}</dd>
          <dt>amount</dt><dd className="ok">{formatUnits(duel.pot, 18)} USDso (the whole pot)</dd>
          <dt>final</dt><dd>strike {market.strike} · spot {market.spot} · {upWon ? 'UP' : 'DOWN'} won</dd>
        </dl>
      )}

      <dl>
        <dt>your leg</dt>
        <dd>{held === null ? <span className="muted">…</span> : `${formatUnits(held, 18)} contracts`}</dd>
        <dt>oracle</dt><dd><OracleLink questionId={market.oracleQuestionId} /></dd>
      </dl>

      <p className="muted">
        Settlement lands by itself — there is no claim button. The redeem below is only for
        the case where it has not landed yet.
      </p>
      <button onClick={() => void redeem()} disabled={pending || held === null || held === 0n}>
        {pending ? 'pending…' : held === 0n ? 'already redeemed' : 'Redeem'}
      </button>
      <TxState pending={pending} error={error} hash={hash} />
    </section>
  );
}
