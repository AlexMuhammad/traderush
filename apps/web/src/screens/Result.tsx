import { useEffect, useState } from 'react';
import { binaryModuleWriteAbi, binarySettlementAbi, erc6909Abi, type BinaryRef } from '@bullrun/sdk';
import { useDuel, useMarket, useSdk } from '../sdk';
import { OracleLink, TxState, useMoney } from '../components/ui';
import { useWallet } from '../walletContext';

/** S7 — Result. Winner, amount, REDEEM, oracle link.
 *  Voided renders as "called off — both sides refunded 0.5", NEVER as a loss (§8.10).
 *
 *  CORRECTION to PRD §6.2 ("No claim button anywhere. Settlement lands by itself").
 *  It does not. dreamdex-bot-kit's docs/event-contracts.md is explicit: "Winnings are
 *  claimed, not received — a settled market pays out only when someone asks it to. The
 *  position does not decay into collateral on its own." Their own bots call `maybeClaim`
 *  every loop for exactly this reason. Shipping the PRD's copy would have told a winner
 *  their money was coming when it was sitting unclaimed. So the button is primary. */
export function Result({ duelId }: { duelId: bigint }) {
  const duel = useDuel(duelId);
  const market = useMarket(duel?.marketId ?? null);
  const { market: adapter, cfg } = useSdk();
  const { conn } = useWallet();
  const money = useMoney();

  const [held, setHeld] = useState<bigint | null>(null);
  const [ref, setRef] = useState<BinaryRef | null>(null);
  /** 0 = YES/UP, 1 = NO/DOWN — the module's own outcome index. */
  const [myIdx, setMyIdx] = useState<0 | 1>(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);

  const settled = market?.status === 'Resolved' || market?.status === 'Voided';

  useEffect(() => {
    if (!duel || !market || !settled || !conn) return;
    let alive = true;
    void (async () => {
      try {
        // The indexer already carries the outcome ids and the market's ORIGIN
        // venue — both are needed to redeem, and neither is derivable from the
        // marketId alone.
        const r = await adapter.ref(duel.marketId);
        if (!r) throw new Error(`market ${duel.marketId} is not in the indexer`);

        const me = conn.account.address.toLowerCase();
        const iAmChallenger = me === duel.challenger.toLowerCase();
        const iAmUp = iAmChallenger ? duel.challengerUp : !duel.challengerUp;
        const idx: 0 | 1 = iAmUp ? 0 : 1;

        // The ERC-6909 singleton is named by the settlement contract rather
        // than guessed at.
        const outcomeToken = await adapter.publicClient.readContract({
          address: cfg.addresses.binarySettlement, abi: binarySettlementAbi,
          functionName: 'outcomeToken',
        }) as `0x${string}`;

        const bal = await adapter.publicClient.readContract({
          address: outcomeToken, abi: erc6909Abi, functionName: 'balanceOf',
          args: [conn.account.address, idx === 0 ? r.upId : r.downId],
        }) as bigint;

        if (alive) { setRef(r); setMyIdx(idx); setHeld(bal); }
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
    if (!conn || !ref || held === null || held === 0n) return;
    setPending(true); setError(null);
    try {
      // redeem is scoped by the market's origin venue, not by whichever venue
      // it was read through. The loser's leg redeems 0 and must not revert
      // (§11), so this is safe to press on either side.
      const { request } = await adapter.publicClient.simulateContract({
        account: conn.account, address: cfg.addresses.binaryModule,
        abi: binaryModuleWriteAbi, functionName: 'redeem',
        args: [ref.operatorId, ref.venueId, duel.marketId, myIdx, held],
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
            each of you gets your {money.format(duel.stake)} stake back. Nobody lost.
          </p>
        </div>
      ) : (
        <dl>
          <dt>winner</dt>
          <dd><code>{winner}</code> {iWon && <span className="ok">— that is you</span>}</dd>
          <dt>amount</dt><dd className="ok">{money.format(duel.pot)} (the whole pot)</dd>
          <dt>final</dt><dd>strike {market.strike} · spot {market.spot} · {upWon ? 'UP' : 'DOWN'} won</dd>
        </dl>
      )}

      <dl>
        <dt>your leg</dt>
        <dd>{held === null ? <span className="muted">…</span> : `${money.plain(held)} contracts`}</dd>
        <dt>oracle</dt><dd><OracleLink questionId={market.oracleQuestionId} /></dd>
      </dl>

      <p className={held && held > 0n ? 'warn' : 'muted'}>
        {held && held > 0n
          ? 'Your winnings are NOT paid out automatically. A settled market pays only when '
            + 'someone asks it to — claim them here.'
          : 'Nothing left to claim on this leg.'}
      </p>
      <button onClick={() => void redeem()} disabled={pending || held === null || held === 0n}>
        {pending ? 'pending…' : held === 0n ? 'already claimed' : `Claim ${voided ? 'refund' : 'winnings'}`}
      </button>
      <TxState pending={pending} error={error} hash={hash} />
    </section>
  );
}
