import { useMemo, useState } from 'react';
import { DuelAdapter, UI_FREEZE_SEC } from '@bullrun/sdk';
import { useAllowance, useDuel, useMarket, useSdk, useNow } from '../sdk';
import { StatusBadge, TxState, useMoney } from '../components/ui';
import { useWallet } from '../walletContext';

interface Link { chainId: number; escrow: `0x${string}`; duelId: bigint }

/** S8 — Accept, opened from the link. Terms and one Accept button.
 *  Guards: wrong chain, insufficient balance, deadline passed, already matched, self-duel. */
export function AcceptDuel({ link, navigate }: { link: Link; navigate: (to: string) => void }) {
  const { cfg, market } = useSdk();
  const { conn, wrongChain, doConnect, doSwitch, connecting } = useWallet();
  const now = useNow();
  const money = useMoney();

  // The link names its own escrow, so an old link keeps working after a redeploy.
  const adapter = useMemo(
    () => new DuelAdapter(cfg, link.escrow),
    [cfg, link.escrow],
  );
  const duel = useDuel(link.duelId, adapter);
  const state = useMarket(duel?.marketId ?? null);

  const [balance, setBalance] = useState<bigint | null>(null);
  const allow = useAllowance(conn?.account.address as `0x${string}` | undefined, duel?.stake ?? 0n);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);

  useMemo(() => {
    if (!conn || wrongChain) return;
    market.balance(conn.account.address).then(setBalance).catch(() => setBalance(null));
  }, [conn, wrongChain, market]);

  // A testnet link must never open against a mainnet build, or the reader would be
  // shown terms from a duel that does not exist on the chain they are about to sign on.
  if (link.chainId !== cfg.chainId) {
    return (
      <p className="err">
        This link is for chain {link.chainId}, but this build is {cfg.network} (chain {cfg.chainId}).
      </p>
    );
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
    wrongChain && `wrong network — switch to ${cfg.chainName} (chain ${cfg.chainId})`,
    duel.status === 'Matched' && 'this duel has already been matched',
    duel.status === 'Cancelled' && 'this duel was cancelled and the stake refunded',
    duel.status === 'Open' && deadlinePassed && 'the accept deadline has passed',
    selfDuel && 'you opened this duel — you cannot accept your own',
    insufficient && `insufficient balance: you need ${money.format(duel.stake)}`,
    notTrading && `market is ${state?.status}; only Trading accepts mints`,
    nearExpiry && 'too close to expiry — accepting now would revert for both parties (§8.11)',
    allow.enough === false && 'the escrow needs permission to move your stake',
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
        <dt>your stake</dt><dd>{money.format(duel.stake)}</dd>
        <dt>pot</dt><dd>{money.format(duel.pot)}</dd>
        <dt>payout if you win</dt><dd className="ok">{money.format(duel.pot)}</dd>
        <dt>max loss</dt><dd className="err">{money.format(duel.stake)}</dd>
        <dt>accept deadline</dt>
        <dd>{deadlinePassed ? <span className="warn">passed</span> : `${duel.acceptDeadline - now}s left`}</dd>
      </dl>

      {blockers.map((b) => <p key={b} className="warn">{b}</p>)}

      <div className="row">
        {!conn && <button onClick={doConnect} disabled={connecting}>Connect wallet</button>}
        {wrongChain && <button onClick={doSwitch}>Switch to {cfg.chainName}</button>}
        {allow.enough === false ? (
          <button
            onClick={() => conn && void allow.approve(conn.wallet, conn.account)}
            disabled={allow.approving}
          >
            {allow.approving ? 'approving…' : `Approve ${money.symbol} (one time)`}
          </button>
        ) : (
          <button onClick={accept} disabled={blockers.length > 0 || pending}>
            {pending ? 'pending…' : `Accept — stake ${money.format(duel.stake)}`}
          </button>
        )}
        <button onClick={() => navigate(`/duel/${link.duelId}`)}>view duel</button>
      </div>

      <TxState pending={pending} error={error} hash={hash} />
      <p className="muted">
        Accepting mints {money.plain(duel.pot)} complete sets and hands you the {mySide} leg.
        No builder fee applies to duels.
      </p>
    </section>
  );
}
