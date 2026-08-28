import { useMemo, useState } from 'react';
import { formatUnits } from 'viem';
import { DuelAdapter, CHAIN_ID, UI_FREEZE_SEC } from '@bullrun/sdk';
import { useDuel, useMarket, useSdk, useNow } from '../sdk';
import { StatusBadge, TxState } from '../components/ui';
import { useWallet } from '../App';

interface Link { chainId: number; escrow: `0x${string}`; duelId: bigint }

/** S8 — Accept, opened from the link. Terms and one Accept button.
 *  Guards: wrong chain, insufficient balance, deadline passed, already matched, self-duel. */
export function AcceptDuel({ link, navigate }: { link: Link; navigate: (to: string) => void }) {
  const { cfg, market } = useSdk();
  const { conn, wrongChain, doConnect, doSwitch, connecting } = useWallet();
  const now = useNow();

  // The link names its own escrow, so an old link keeps working after a redeploy.
  const adapter = useMemo(
    () => new DuelAdapter(cfg, link.escrow),
    [cfg, link.escrow],
  );
  const duel = useDuel(link.duelId, adapter);
  const state = useMarket(duel?.marketId ?? null);

  const [balance, setBalance] = useState<bigint | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);

  useMemo(() => {
    if (!conn || wrongChain) return;
    market.balance(conn.account.address).then(setBalance).catch(() => setBalance(null));
  }, [conn, wrongChain, market]);

  if (link.chainId !== CHAIN_ID) {
    return <p className="err">This link is for chain {link.chainId}. BULLRUN runs on {CHAIN_ID} only.</p>;
  }
  if (duel === undefined) return <p className="muted">reading duel #{String(link.duelId)} on-chain…</p>;
  if (duel === null) return <p className="err">No duel #{String(link.duelId)} at escrow {link.escrow}.</p>;

  const me = conn?.account.address.toLowerCase();
  const selfDuel = me === duel.challenger.toLowerCase();
  const deadlinePassed = now >= duel.acceptDeadline;
  const nearExpiry = Boolean(state?.expiryTime) && now >= state!.expiryTime - UI_FREEZE_SEC;
  const notTrading = Boolean(state) && state!.status !== 'Trading';
  const insufficient = balance !== null && balance < duel.stake;

  const blockers = [
    !conn && 'connect your wallet',
    wrongChain && `wrong network — switch to chain ${CHAIN_ID}`,
    duel.status === 'Matched' && 'this duel has already been matched',
    duel.status === 'Cancelled' && 'this duel was cancelled and the stake refunded',
    duel.status === 'Open' && deadlinePassed && 'the accept deadline has passed',
    selfDuel && 'you opened this duel — you cannot accept your own',
    insufficient && `insufficient balance: you need ${formatUnits(duel.stake, 18)} USDso`,
    notTrading && `market is ${state?.status}; only Trading accepts mints`,
    nearExpiry && 'too close to expiry — accepting now would revert for both parties (§8.11)',
  ].filter(Boolean) as string[];

  const accept = () => {
    if (!conn) return;
    setPending(true); setError(null);
    adapter.accept(conn.wallet, conn.account, link.duelId)
      .then((r) => setHash(r.txHash))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setPending(false));
  };

  const mySide = duel.challengerUp ? 'DOWN' : 'UP';

  return (
    <section>
      <h2>
        Duel #{String(link.duelId)} — you have been challenged
        {state && <> · <StatusBadge status={state.status} /></>}
      </h2>

      <dl>
        <dt>challenger</dt><dd><code>{duel.challenger}</code> — {duel.challengerUp ? 'UP' : 'DOWN'}</dd>
        <dt>your side</dt><dd><strong>{mySide}</strong></dd>
        <dt>market</dt>
        <dd>{state ? `${state.symbol} · ${state.intervalSec}s · strike ${state.strike} · spot ${state.spot}` : <code>{duel.marketId}</code>}</dd>
        <dt>your stake</dt><dd>{formatUnits(duel.stake, 18)} USDso</dd>
        <dt>pot</dt><dd>{formatUnits(duel.pot, 18)} USDso</dd>
        <dt>payout if you win</dt><dd className="ok">{formatUnits(duel.pot, 18)} USDso</dd>
        <dt>max loss</dt><dd className="err">{formatUnits(duel.stake, 18)} USDso</dd>
        <dt>accept deadline</dt>
        <dd>{deadlinePassed ? <span className="warn">passed</span> : `${duel.acceptDeadline - now}s left`}</dd>
      </dl>

      {blockers.map((b) => <p key={b} className="warn">{b}</p>)}

      <div className="row">
        {!conn && <button onClick={doConnect} disabled={connecting}>Connect wallet</button>}
        {wrongChain && <button onClick={doSwitch}>Switch to Shannon</button>}
        <button onClick={accept} disabled={blockers.length > 0 || pending}>
          {pending ? 'pending…' : `Accept — stake ${formatUnits(duel.stake, 18)} USDso`}
        </button>
        <button onClick={() => navigate(`/duel/${link.duelId}`)}>view duel</button>
      </div>

      <TxState pending={pending} error={error} hash={hash} />
      <p className="muted">
        Accepting mints {formatUnits(duel.pot, 18)} complete sets and hands you the {mySide} leg.
        No builder fee applies to duels.
      </p>
    </section>
  );
}
