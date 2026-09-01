import { useEffect, useState } from 'react';
import { binarySettlementAbi, erc6909Abi, oracleUrl, type BinaryRef } from '@traderush/sdk';
import { useDuel, useMarket, useNow, useSdk } from '../../sdk';
import { useWallet } from '../../walletContext';
import { useMoney } from '../components/money';
import { Key } from '../components/Key';
import { Addr, Loading, Fault, Readout, TxLine } from '../components/Readout';
import { MatchScreen } from '../components/MatchScreen';
import { useShare } from '../share/shareContext';
import type { WinCard } from '../share/winCard';
import { intervalLabel, price } from '../engine/market';

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
  const share = useShare();
  /** Kept after the payout so the card stays reachable. */
  const [card, setCard] = useState<WinCard | null>(null);

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

    const trend = market && market.spot >= market.strike ? 'up' : 'dn';

    return (
      <>
        <div className="q">
          <span className="exp">
            {duel.status === 'Cancelled' ? 'refunded' : expired ? 'expired' : `${Math.floor(left / 60)}m ${left % 60}s`}
          </span>
          Duel <b>#{String(duelId)}</b> — <b>{money.format(duel.stake)}</b> a side,
          winner takes <b>{money.format(duel.pot)}</b>
        </div>

        {market && (
          <div className="window">
            <div className="crt">
              {/* Nothing is minted yet, so nobody is being hunted — the window is
                  simply running, and this is the one being offered. */}
              <MatchScreen state={market} side={null} />
            </div>
            <div className="readout">
              <span className={`px ${trend}`}>{price(market.spot)}</span>
              <span className={`dl ${trend}`}>
                {market.spot >= market.strike ? '+' : ''}{(market.spot - market.strike).toFixed(2)}
              </span>
              <span>strike {price(market.strike)}</span>
            </div>
          </div>
        )}

        <div className="order">
          <div className="trayrow">
            <div className="calc">
              <span>challenger</span>
              <span className={duel.challengerUp ? 'up' : 'dn'}>
                {duel.challengerUp ? 'UP' : 'DOWN'}
              </span>
            </div>
            <div className="calc">
              <span>their address</span>
              <span><Addr value={duel.challenger} /></span>
            </div>
          </div>
          <div className="calc">
            <span>{duel.status === 'Cancelled' ? 'refunded' : expired ? 'expired' : 'accepting until'}</span>
            <span className={expired && duel.status === 'Open' ? 'dn' : undefined}>
              {duel.status === 'Cancelled' ? 'the stake went back to the challenger'
                : expired ? 'nobody accepted — nothing was minted'
                : `${Math.floor(left / 60)}m ${left % 60}s from now`}
            </span>
          </div>
        </div>

        {duel.status === 'Open' && !expired && (
          <>
            <p className="hint">Waiting for an opponent. Send them this.</p>
            <div className="linkline">
              <code title={url}>{url}</code>
              <button onClick={() => void navigator.clipboard.writeText(url)}>copy</button>
            </div>
          </>
        )}
        {!canCancel && !expired && duel.status === 'Open' && (
          <p className="hint">Only the challenger can cancel before the deadline.</p>
        )}

        <div className="calls calls--act">
          <Key onPress={onBack}><span className="nm">back</span></Key>
          {duel.status === 'Open' ? (
            <Key lit={canCancel} disabled={!canCancel}
                 onPress={() => conn && run(() => duels!.cancel(conn.wallet, conn.account, duelId))}>
              <span className="nm">{pending ? 'pending…' : 'cancel and refund'}</span>
            </Key>
          ) : (
            <Key disabled><span className="nm">refunded</span></Key>
          )}
        </div>

        {error ? <Fault error={error} /> : null}
        {hash && <TxLine hash={hash} />}
      </>
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

        // A duel knows both halves — stake in, pot out — so its card can carry
        // the multiple. It is a flat 2x by construction, which is the one number
        // a duel has that a room never does.
        const won: WinCard = {
          market: market ? `${market.symbol} · ${intervalLabel(market.intervalSec)}` : `Duel #${duelId}`,
          side: myUp ? 'up' : 'down',
          payout: money.format(held),
          stake: money.format(duel.stake),
          multiple: `×${(Number(money.plain(held)) / Number(money.plain(duel.stake))).toFixed(2)}`,
          net: `${held >= duel.stake ? '+' : ''}${money.plain(held - duel.stake)}`,
          strike: market ? price(market.strike) : undefined,
          close: market ? price(market.spot) : undefined,
        };
        setCard(won);
        share?.(won);
        setHeld(0n);
      } catch (e) { setError(e); }
      finally { setPending(false); }
    };

    const trend = market.spot >= market.strike ? 'up' : 'dn';

    return (
      <>
        <div className="q">
          <span className="exp">{voided ? 'called off' : 'settled'}</span>
          Duel <b>#{String(duelId)}</b> — {voided
            ? 'the market was voided, so nobody lost'
            : iWon ? <b>you took the pot</b> : 'the other side took the pot'}
        </div>

        <div className="window">
          <div className="crt">
            <MatchScreen state={market} side={myUp ? 'up' : 'down'} />
          </div>
          <div className="readout">
            <span className={`px ${trend}`}>{price(market.spot)}</span>
            <span className={`dl ${trend}`}>{upWon ? 'UP' : 'DOWN'}</span>
            <span>strike {price(market.strike)}</span>
          </div>
        </div>

        <div className="order">
          {voided ? (
            // §8.10 — a void is not a loss.
            <div className="calc">
              <span>called off</span>
              <span>both sides redeem half — your {money.format(duel.stake)} comes back</span>
            </div>
          ) : (
            <div className="trayrow">
              <div className="calc">
                <span>winner</span>
                <span className={iWon ? 'up' : undefined}>
                  {iWon ? 'you' : <Addr value={winner} />}
                </span>
              </div>
              <div className="calc">
                <span>pot</span>
                <span className="lamp">{money.format(duel.pot)}</span>
              </div>
            </div>
          )}
          <div className="calc">
            <span>your leg</span>
            <span>{held === null ? '…' : `${money.plain(held)} contracts`}</span>
          </div>
          <div className="calc">
            <span>oracle</span>
            <span>
              {market.oracleQuestionId
                ? <a href={oracleUrl(cfg, market.oracleQuestionId)} target="_blank" rel="noreferrer">oracle question</a>
                : 'none'}
            </span>
          </div>
        </div>

        {/* CORRECTION to PRD §6.2: winnings are claimed, not received. */}
        {held !== null && held > 0n && (
          <p className="hint hint--warn">
            Winnings are not paid out automatically — a settled market pays only when asked.
          </p>
        )}

        <div className="calls calls--act">
          <Key onPress={onBack}><span className="nm">back</span></Key>
          {held !== null && held === 0n && card ? (
            // Paid. The key stops offering money that has already moved.
            <Key lit onPress={() => share?.(card)}>
              <span className="nm">your card</span>
            </Key>
          ) : (
            <Key lit={Boolean(held && held > 0n)} disabled={pending || !held || held === 0n}
                 onPress={() => void claim()}>
              <span className="nm">
                {pending ? 'pending…'
                  : held === 0n ? 'nothing to claim'
                  : `claim ${voided ? 'refund' : 'winnings'}`}
              </span>
            </Key>
          )}
        </div>

        {error ? <Fault error={error} /> : null}
        {hash && <TxLine hash={hash} label="claimed" />}
      </>
    );
  }

  // ------------------------------------------------------------------- live
  const upWinning = market ? market.spot > market.strike : false;
  const challengerAhead = duel.challengerUp === upWinning;
  const delta = market ? market.spot - market.strike : 0;
  const left = market ? Math.max(0, market.expiryTime - now) : 0;

  // Only a player gets hunted. A spectator sees the same window with both
  // animals still on it, which is exactly what a spectator should see.
  const iAmIn = Boolean(me && (me === duel.challenger.toLowerCase() || me === duel.opponent.toLowerCase()));
  const mySide = iAmIn ? (myUp ? 'up' : 'down') : null;
  const trend = delta >= 0 ? 'up' : 'dn';

  return (
    <>
      <div className="q">
        <span className="exp">{left ? `${Math.floor(left / 60)}m ${left % 60}s` : '—'}</span>
        Duel <b>#{String(duelId)}</b> — winner takes <b>{money.format(duel.pot)}</b>
      </div>

      {market && (
        <div className="window">
          <div className="crt">
            {/* The same scene the game face draws. A duel IS the run: same
                market, same line, same two animals — and here two people have
                money on which side of it the price ends. */}
            <MatchScreen state={market} side={mySide} />
          </div>
          <div className="readout">
            <span className={`px ${trend}`}>{price(market.spot)}</span>
            <span className={`dl ${trend}`}>{delta >= 0 ? '+' : ''}{delta.toFixed(2)}</span>
            <span>strike {price(market.strike)}</span>
          </div>
        </div>
      )}

      <div className="order">
        <div className="trayrow">
          <div className="calc">
            <span>challenger</span>
            <span className={challengerAhead ? 'up' : undefined}>
              {duel.challengerUp ? 'UP' : 'DOWN'} · {challengerAhead ? 'ahead' : 'behind'}
            </span>
          </div>
          <div className="calc">
            <span>opponent</span>
            <span className={!challengerAhead ? 'up' : undefined}>
              {duel.challengerUp ? 'DOWN' : 'UP'} · {!challengerAhead ? 'ahead' : 'behind'}
            </span>
          </div>
        </div>
        <div className="calc">
          <span>{iAmIn ? 'your side' : 'watching'}</span>
          <span className={iAmIn ? (myUp ? 'up' : 'dn') : undefined}>
            {iAmIn ? (myUp ? 'UP' : 'DOWN') : 'not in this duel'}
          </span>
        </div>
      </div>

      <p className="hint">
        Read-only. A duel has no exit: both legs are minted and there is nobody to
        sell to.
      </p>

      <div className="calls calls--act">
        <Key onPress={onBack}><span className="nm">back</span></Key>
        <Key disabled><span className="nm">running</span></Key>
      </div>
    </>
  );
}
