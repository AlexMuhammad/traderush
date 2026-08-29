import { useEffect, useMemo, useState } from 'react';
import { DuelAdapter, UI_FREEZE_SEC } from '@traderush/sdk';
import { useAllowance, useDuel, useMarket, useNow, useSdk } from '../../sdk';
import { useWallet } from '../../walletContext';
import { useMoney } from '../components/money';
import { Key } from '../components/Key';
import { Addr, Loading, Fault, Readout, Row, Rows, TxLine } from '../components/Readout';
import { Trail } from '../components/Trail';
import { human, intervalLabel, price } from '../engine/market';

export interface DuelLink { chainId: number; escrow: `0x${string}`; duelId: bigint }

/** The console's S8: someone opened your link. Terms, guards, one key. */
export function AcceptPanel({ link, onAccepted }: { link: DuelLink; onAccepted: () => void }) {
  const { cfg, market: adapter } = useSdk();
  const { conn, wrongChain, connecting, doConnect, doSwitch } = useWallet();
  const money = useMoney();
  const now = useNow();

  // The link names its own escrow, so an old link still works after a redeploy.
  const duels = useMemo(() => {
    try { return new DuelAdapter(cfg, link.escrow); } catch { return null; }
  }, [cfg, link.escrow]);

  const duel = useDuel(duels ? link.duelId : null, duels);
  const state = useMarket(duel?.marketId ?? null);
  const allow = useAllowance(conn?.account.address as `0x${string}` | undefined, duel?.stake ?? 0n);

  const [balance, setBalance] = useState<bigint | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [hash, setHash] = useState<string | null>(null);

  useEffect(() => {
    if (!conn || wrongChain) { setBalance(null); return; }
    adapter.balance(conn.account.address).then(setBalance).catch(() => setBalance(null));
  }, [conn, wrongChain, adapter, hash]);

  if (link.chainId !== cfg.chainId) {
    return (
      <Readout title="Wrong network">
        <p className="note err">
          This link is for chain {link.chainId}; this build is {cfg.network} (chain {cfg.chainId}).
        </p>
      </Readout>
    );
  }
  if (duel === undefined) return <Readout title={`Duel #${link.duelId}`}><Loading /></Readout>;
  if (duel === null) return <Readout title={`Duel #${link.duelId}`}><p className="note err">No such duel at {link.escrow.slice(0, 10)}…</p></Readout>;

  const selfDuel = conn?.account.address.toLowerCase() === duel.challenger.toLowerCase();
  const deadlinePassed = now >= duel.acceptDeadline;
  const nearExpiry = Boolean(state?.expiryTime) && now >= state!.expiryTime - UI_FREEZE_SEC;
  const mySide = duel.challengerUp ? 'DOWN' : 'UP';

  const blockers = [
    !conn && 'connect a wallet',
    wrongChain && `wrong network — switch to ${cfg.chainName}`,
    duel.status === 'Matched' && 'already matched',
    duel.status === 'Cancelled' && 'cancelled and refunded',
    duel.status === 'Open' && deadlinePassed && 'the accept deadline has passed',
    selfDuel && 'you opened this duel',
    balance !== null && balance < duel.stake && `you need ${money.format(duel.stake)}`,
    state && state.status !== 'Trading' && `market is ${state.status}`,
    nearExpiry && 'too close to expiry — this would revert for both of you',
  ].filter(Boolean) as string[];

  const accept = () => {
    if (!conn || !duels) return;
    setPending(true); setError(null);
    duels.accept(conn.wallet, conn.account, link.duelId)
      .then((r) => { setHash(r.txHash); onAccepted(); })
      .catch((e) => setError(e))
      .finally(() => setPending(false));
  };

  return (
    <Readout title={`Duel #${link.duelId}`} right="challenged">
      {state && <Trail state={state} />}
      <Rows>
        <Row label="challenger"><Addr value={duel.challenger} /> · {duel.challengerUp ? 'UP' : 'DOWN'}</Row>
        <Row label="your side" tone="lamp">{mySide}</Row>
        <Row label="market">
          {state ? `${state.symbol} · ${intervalLabel(state.intervalSec)} · strike ${price(state.strike)} · spot ${price(state.spot)}` : 'reading…'}
        </Row>
        <Row label="your stake">{money.format(duel.stake)}</Row>
        <Row label="pot" tone="lamp">{money.format(duel.pot)}</Row>
        <Row label="you win" tone="up">{money.format(duel.pot)}</Row>
        <Row label="max loss" tone="dn">{money.format(duel.stake)}</Row>
        <Row label="deadline">{deadlinePassed ? 'passed' : `${human(duel.acceptDeadline - now)} left`}</Row>
      </Rows>

      {blockers.map((b) => <p key={b} className="note warn">{b}</p>)}

      {!conn && (
        <Key className="action" disabled={connecting} onPress={doConnect}>
          {connecting ? 'connecting…' : 'Connect wallet'}
        </Key>
      )}
      {conn && wrongChain && <Key className="action" onPress={doSwitch}>Switch to {cfg.chainName}</Key>}
      {conn && !wrongChain && allow.enough === false && (
        <Key className="action" disabled={allow.approving}
             onPress={() => void allow.approve(conn.wallet, conn.account)}>
          {allow.approving ? 'approving…' : `Approve ${money.symbol}`}
        </Key>
      )}
      {conn && !wrongChain && allow.enough !== false && (
        <Key className="action" disabled={blockers.length > 0 || pending} onPress={accept}>
          {pending ? 'pending…' : `Accept — ${money.format(duel.stake)}`}
        </Key>
      )}

      {error ? <Fault error={error} /> : null}
      {hash && <TxLine hash={hash} label="matched" />}
      <p className="note">
        Accepting mints {money.plain(duel.pot)} complete sets and hands you the {mySide} leg.
        No builder fee applies to duels.
      </p>
    </Readout>
  );
}
