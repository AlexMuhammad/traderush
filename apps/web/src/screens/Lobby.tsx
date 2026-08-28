import { useState } from 'react';
import { formatUnits } from 'viem';
import { useDuel, useSdk, useNow } from '../sdk';
import { CopyButton, TxState } from '../components/ui';
import { useWallet } from '../App';

/** S5 — Lobby. Link, countdown to acceptDeadline, status, Cancel. On Matched → S6. */
export function Lobby({ duelId, navigate }: { duelId: bigint; navigate: (to: string) => void }) {
  const duel = useDuel(duelId);
  const { duels } = useSdk();
  const { conn } = useWallet();
  const now = useNow();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);

  if (duel === undefined) return <p className="muted">reading duel #{String(duelId)} on-chain…</p>;
  if (duel === null) return <p className="err">duel #{String(duelId)} does not exist on this escrow</p>;
  // S6 and S7 render this duel instead once it is matched.
  if (duel.status !== 'Open') return null;

  const url = `${window.location.origin}${duels!.link(duels!.publicClient.chain?.id ?? 0, duelId)}`;
  const left = duel.acceptDeadline - now;
  const expired = left <= 0;
  const isChallenger = conn?.account.address.toLowerCase() === duel.challenger.toLowerCase();
  // The escrow lets anyone cancel once the deadline has passed, so a stake can never
  // be stranded by an absent challenger.
  const canCancel = Boolean(conn) && (isChallenger || expired) && !pending;

  const cancel = () => {
    if (!conn) return;
    setPending(true); setError(null);
    duels!.cancel(conn.wallet, conn.account, duelId)
      .then((r) => setHash(r.txHash))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setPending(false));
  };

  return (
    <section>
      <h2>Duel #{String(duelId)} · {expired ? 'expired' : 'waiting'}</h2>
      <dl>
        <dt>challenger</dt><dd><code>{duel.challenger}</code> — {duel.challengerUp ? 'UP' : 'DOWN'}</dd>
        <dt>stake per side</dt><dd>{formatUnits(duel.stake, 18)} USDso</dd>
        <dt>pot</dt><dd>{formatUnits(duel.pot, 18)} USDso</dd>
        <dt>accept deadline</dt>
        <dd>{expired ? <span className="warn">passed</span> : `${Math.floor(left / 60)}m ${left % 60}s left`}</dd>
      </dl>

      {!expired && (
        <>
          <p>Share this link with your opponent:</p>
          <div className="row"><code>{url}</code><CopyButton text={url} /></div>
        </>
      )}
      {expired && (
        <p className="warn">
          Nobody accepted. Nothing was ever minted — cancel refunds the stake exactly.
        </p>
      )}

      <div className="row">
        <button onClick={cancel} disabled={!canCancel}>
          {pending ? 'pending…' : 'Cancel and refund'}
        </button>
        <button onClick={() => navigate('/')}>markets</button>
      </div>
      {!canCancel && !expired && <p className="muted">only the challenger can cancel before the deadline</p>}
      <TxState pending={pending} error={error} hash={hash} />
    </section>
  );
}
