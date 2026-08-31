import { useEffect, useMemo, useState } from 'react';
import { DuelAdapter, UI_FREEZE_SEC } from '@traderush/sdk';
import { useAllowance, useDuel, useMarket, useNow, useSdk } from '../../sdk';
import { useWallet } from '../../walletContext';
import { useMoney } from '../components/money';
import { Key } from '../components/Key';
import { Addr, Loading, Fault, Readout, Row, Rows, TxLine } from '../components/Readout';
import { MatchScreen } from '../components/MatchScreen';
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

  // One press, two signatures the first time. The approval rides along with the
  // accept rather than standing in front of it.
  const accept = async () => {
    if (!conn || !duels) return;
    setPending(true); setError(null);
    try {
      await allow.ensure(conn.wallet, conn.account, duel.stake);
      const r = await duels.accept(conn.wallet, conn.account, link.duelId);
      setHash(r.txHash);
      onAccepted();
    } catch (e) { setError(e); }
    finally { setPending(false); }
  };

  const trend = state && state.spot >= state.strike ? 'up' : 'dn';
  const ready = Boolean(conn) && !wrongChain && blockers.length === 0 && !pending;

  return (
    <>
      <div className="q">
        <span className="exp">{deadlinePassed ? 'expired' : `${human(duel.acceptDeadline - now)} left`}</span>
        You have been challenged on <b>{state?.symbol ?? '…'}</b> — your side is <b>{mySide}</b>.
      </div>

      {state && (
        <div className="window">
          <div className="crt">
            {/* The window you are being asked to take a side of, running. The
                animal that comes for you is already the right one. */}
            <MatchScreen state={state} side={mySide === 'UP' ? 'up' : 'down'} />
          </div>
          <div className="readout">
            <span className={`px ${trend}`}>{price(state.spot)}</span>
            <span className={`dl ${trend}`}>
              {state.spot >= state.strike ? '+' : ''}{(state.spot - state.strike).toFixed(2)}
            </span>
            <span>strike {price(state.strike)}</span>
          </div>
        </div>
      )}

      <div className="order">
        <div className="trayrow">
          <div className="calc">
            <span>your side</span>
            <span className={mySide === 'UP' ? 'up' : 'dn'}>{mySide}</span>
          </div>
          <div className="calc">
            <span>challenger</span>
            <span><Addr value={duel.challenger} /></span>
          </div>
        </div>
        <div className="calc">
          <span>your stake</span>
          <span>{money.format(duel.stake)}</span>
        </div>
        <div className="calc">
          <span>you win · max loss</span>
          <span><em className="lamp">{money.format(duel.pot)}</em> · {money.format(duel.stake)}</span>
        </div>
        {blockers.map((b) => (
          <div key={b} className="calc calc--bad"><span>blocked</span><span>{b}</span></div>
        ))}
      </div>

      <p className="hint">
        Accepting mints {money.plain(duel.pot)} complete sets and hands you the {mySide} leg.
        No builder fee applies to duels.
      </p>

      <div className="calls calls--act">
        {!conn ? (
          <>
            <Key disabled><span className="nm">back</span></Key>
            <Key lit disabled={connecting} onPress={doConnect}>
              <span className="nm">{connecting ? 'connecting…' : 'sign in'}</span>
            </Key>
          </>
        ) : wrongChain ? (
          <>
            <Key disabled><span className="nm">back</span></Key>
            <Key lit onPress={doSwitch}><span className="nm">switch network</span></Key>
          </>
        ) : (
          <>
            <Key disabled><span className="nm">back</span></Key>
            <Key lit={ready} disabled={!ready} onPress={() => void accept()}>
              <span className="nm">
                {allow.approving ? 'approving…' : pending ? 'pending…' : `accept ${money.format(duel.stake)}`}
              </span>
            </Key>
          </>
        )}
      </div>

      {error ? <Fault error={error} /> : null}
      {hash && <TxLine hash={hash} label="matched" />}
    </>
  );
}
