import { useEffect, useState } from 'react';
import { binarySettlementAbi, erc6909Abi, oracleUrl, type BinaryRef } from '@bullrun/sdk';
import { useDuel, useMarket, useNow, useSdk } from '../../sdk';
import { useWallet } from '../../walletContext';
import { useMoney } from '../components/money';
import { Key } from '../components/Key';
import { Addr, Loading, Fault, Readout, Row, Rows, TxLine } from '../components/Readout';

/**
 * One duel, from lobby to payout — the console's S5, S6 and S7.
 *
 * They are one screen because the duel's own state decides which it is: Open is
 * a lobby, Matched is a live duel, and a settled market turns it into a receipt.
 */
export function DuelPanel({ duelId, onBack }: { duelId: bigint; onBack: () => void }) {
  const duel = useDuel(duelId);
  const market = useMarket(duel?.marketId ?? null);
  const { duels, cfg, market: adapter } = useSdk();
  const { conn } = useWallet();
  const money = useMoney();
  const now = useNow();

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [hash, setHash] = useState<string | null>(null);

  // Settlement holdings, only once the window is done.
  const [ref, setRef] = useState<BinaryRef | null>(null);
  const [held, setHeld] = useState<bigint | null>(null);
  const settled = market?.status === 'Resolved' || market?.status === 'Voided';

  const me = conn?.account.address.toLowerCase();
  const iAmChallenger = Boolean(duel && me === duel.challenger.toLowerCase());
  const myUp = duel ? (iAmChallenger ? duel.challengerUp : !duel.challengerUp) : true;

  useEffect(() => {
    if (!duel || !settled || !conn) return;
    let alive = true;
    void (async () => {
      try {
        const r = await adapter.ref(duel.marketId);
        if (!r) return;
        const outcomeToken = await adapter.publicClient.readContract({
          address: cfg.addresses.binarySettlement, abi: binarySettlementAbi, functionName: 'outcomeToken',
        }) as `0x${string}`;
        const bal = await adapter.publicClient.readContract({
          address: outcomeToken, abi: erc6909Abi, functionName: 'balanceOf',
          args: [conn.account.address, myUp ? r.upId : r.downId],
        }) as bigint;
        if (alive) { setRef(r); setHeld(bal); }
      } catch (e) { if (alive) setError(e); }
    })();
    return () => { alive = false; };
  }, [duel, settled, conn, adapter, cfg.addresses.binarySettlement, myUp]);

  if (duel === undefined) return <Readout title={`Duel #${duelId}`}><Loading /></Readout>;
  if (duel === null) return <Readout title={`Duel #${duelId}`}><p className="note err">No such duel on this escrow.</p></Readout>;

  const run = (fn: () => Promise<{ txHash: string }>) => {
    setPending(true); setError(null);
    fn().then((r) => setHash(r.txHash))
      .catch((e) => setError(e))
      .finally(() => setPending(false));
  };

  // ------------------------------------------------------------------ lobby
  if (duel.status === 'Open' || duel.status === 'Cancelled') {
    const left = duel.acceptDeadline - now;
    const expired = left <= 0;
    const url = `${window.location.origin}${duels!.link(duelId)}`;
    const canCancel = Boolean(conn) && duel.status === 'Open' && (iAmChallenger || expired) && !pending;

    return (
      <Readout title={`Duel #${duelId}`} right={duel.status === 'Cancelled' ? 'refunded' : expired ? 'expired' : 'waiting'}>
        <Rows>
          <Row label="challenger"><Addr value={duel.challenger} /> · {duel.challengerUp ? 'UP' : 'DOWN'}</Row>
          <Row label="stake">{money.format(duel.stake)}</Row>
          <Row label="pot" tone="lamp">{money.format(duel.pot)}</Row>
          <Row label="deadline">{expired ? 'passed' : `${Math.floor(left / 60)}m ${left % 60}s left`}</Row>
        </Rows>

        {duel.status === 'Open' && !expired && (
          <>
            <p className="note">Waiting for an opponent. Send them this.</p>
            <div className="linkline">
              <code>{url}</code>
              <button onClick={() => void navigator.clipboard.writeText(url)}>copy</button>
            </div>
          </>
        )}
        {expired && duel.status === 'Open' && (
          <p className="note warn">Nobody accepted. Nothing was minted — cancel refunds the stake exactly.</p>
        )}
        {duel.status === 'Cancelled' && <p className="note ok">Cancelled. The stake went back to the challenger.</p>}

        {duel.status === 'Open' && (
          <Key className="action" disabled={!canCancel}
               onPress={() => conn && run(() => duels!.cancel(conn.wallet, conn.account, duelId))}>
            {pending ? 'pending…' : 'Cancel and refund'}
          </Key>
        )}
        {!canCancel && !expired && duel.status === 'Open' && (
          <p className="note">Only the challenger can cancel before the deadline.</p>
        )}
        {error ? <Fault error={error} /> : null}
        {hash && <TxLine hash={hash} />}
        <Key className="action" onPress={onBack}>Back</Key>
      </Readout>
    );
  }

  // --------------------------------------------------------------- settled
  if (settled && market) {
    const voided = market.status === 'Voided';
    const upWon = market.spot > market.strike;
    const challengerWon = duel.challengerUp === upWon;
    const winner = challengerWon ? duel.challenger : duel.opponent;
    const iWon = me === winner.toLowerCase();

    const claim = async () => {
      if (!conn || !ref || !held || held === 0n) return;
      setPending(true); setError(null);
      try {
        // BinarySettlement, not the module — the module's redeem reverts once the
        // pool is released. It pays against the outcome id, so any holder can claim.
        const { request } = await adapter.publicClient.simulateContract({
          account: conn.account, address: cfg.addresses.binarySettlement,
          abi: binarySettlementAbi, functionName: 'redeem',
          args: [myUp ? ref.upId : ref.downId, held, conn.account.address],
        });
        const tx = await conn.wallet.writeContract(request);
        await adapter.publicClient.waitForTransactionReceipt({ hash: tx });
        setHash(tx);
        setHeld(0n);
      } catch (e) { setError(e); }
      finally { setPending(false); }
    };

    return (
      <Readout title={`Duel #${duelId}`} right={voided ? 'called off' : 'settled'}>
        {voided ? (
          // §8.10 — a void is not a loss.
          <p className="note warn">
            Called off. The market was voided, so both sides redeem 0.5 — each of you gets
            your {money.format(duel.stake)} back. Nobody lost.
          </p>
        ) : (
          <Rows>
            <Row label="winner" tone="up"><Addr value={winner} />{iWon && ' — you'}</Row>
            <Row label="amount" tone="lamp">{money.format(duel.pot)}</Row>
            <Row label="final">strike {market.strike} · spot {market.spot} · {upWon ? 'UP' : 'DOWN'}</Row>
          </Rows>
        )}

        <Rows>
          <Row label="your leg">{held === null ? '…' : `${money.plain(held)} contracts`}</Row>
          <Row label="oracle">
            {market.oracleQuestionId
              ? <a href={oracleUrl(cfg, market.oracleQuestionId)} target="_blank" rel="noreferrer">oracle question</a>
              : 'none'}
          </Row>
        </Rows>

        {/* CORRECTION to PRD §6.2: winnings are claimed, not received. */}
        <p className={held && held > 0n ? 'note warn' : 'note'}>
          {held && held > 0n
            ? 'Winnings are NOT paid out automatically. A settled market pays only when asked.'
            : 'Nothing left to claim on this leg.'}
        </p>
        <Key className="action" disabled={pending || !held || held === 0n} onPress={() => void claim()}>
          {pending ? 'pending…' : held === 0n ? 'already claimed' : `Claim ${voided ? 'refund' : 'winnings'}`}
        </Key>

        {error ? <Fault error={error} /> : null}
        {hash && <TxLine hash={hash} label="claimed" />}
        <Key className="action" onPress={onBack}>Back</Key>
      </Readout>
    );
  }

  // ------------------------------------------------------------------- live
  const upWinning = market ? market.spot > market.strike : false;
  const challengerAhead = duel.challengerUp === upWinning;
  const delta = market ? market.spot - market.strike : 0;
  const left = market ? Math.max(0, market.expiryTime - now) : 0;

  return (
    <Readout title={`Duel #${duelId}`} right="live">
      <Rows>
        <Row label="challenger" tone={challengerAhead ? 'up' : undefined}>
          <Addr value={duel.challenger} /> · {duel.challengerUp ? 'UP' : 'DOWN'}
          {challengerAhead ? ' · ahead' : ' · behind'}
        </Row>
        <Row label="opponent" tone={!challengerAhead ? 'up' : undefined}>
          <Addr value={duel.opponent} /> · {duel.challengerUp ? 'DOWN' : 'UP'}
          {!challengerAhead ? ' · ahead' : ' · behind'}
        </Row>
        <Row label="pot" tone="lamp">{money.format(duel.pot)} — winner takes all</Row>
        {market && <Row label="strike">{market.strike}</Row>}
        {market && <Row label="spot" tone={delta >= 0 ? 'up' : 'dn'}>{market.spot}</Row>}
        {market && (
          <Row label="delta" tone={delta >= 0 ? 'up' : 'dn'}>
            {delta >= 0 ? '+' : ''}{delta.toFixed(4)} — {upWinning ? 'UP' : 'DOWN'} ahead
          </Row>
        )}
        <Row label="expiry">{left ? `${Math.floor(left / 60)}m ${left % 60}s` : '—'}</Row>
      </Rows>
      <p className="note">
        Read-only. A duel has no exit: both legs are minted and there is nobody to sell to.
      </p>
      <Key className="action" onPress={onBack}>Back</Key>
    </Readout>
  );
}
