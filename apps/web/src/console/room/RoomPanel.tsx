import { useEffect, useState } from 'react';
import { binarySettlementAbi, erc6909Abi, oracleUrl, type BinaryRef } from '@traderush/sdk';
import { useMarket, useNow, useRoom, useSdk, useSeat } from '../../sdk';
import { useWallet } from '../../walletContext';
import { useMoney } from '../components/money';
import { Key } from '../components/Key';
import { SideIcon } from '../components/SideIcon';
import { Loading, Fault, Readout, TxLine } from '../components/Readout';
import { MatchScreen } from '../components/MatchScreen';
import { useShare } from '../share/shareContext';
import { intervalLabel, price } from '../engine/market';
import { useRoomAllowance } from './useRoomAllowance';

/**
 * One room, from open to payout.
 *
 * It is a single screen because the room's own state decides which one it is:
 * entry open is a lobby you can still join, entry closed is a claim, a room
 * nobody contested is a refund, and a settled market is a redeem.
 */
export function RoomPanel({
  roomId, escrow, onBack,
}: {
  roomId: bigint;
  /** From an invite link, which names its own escrow so an old link survives a
   *  redeploy. Undefined means the one this build is configured with. */
  escrow?: `0x${string}`;
  onBack: () => void;
}) {
  const { rooms, cfg, market: adapter } = useSdk();
  const { conn, connecting, doConnect } = useWallet();
  const money = useMoney();
  const now = useNow();
  const share = useShare();

  const room = useRoom(roomId);
  const seat = useSeat(roomId, room);
  const state = useMarket(room?.marketId ?? null);

  const [side, setSide] = useState<'up' | 'down'>('up');
  const [stakeStr, setStakeStr] = useState('1');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [hash, setHash] = useState<string | null>(null);

  let stake = 0n;
  try { stake = money.parse(stakeStr || '0'); } catch { /* surfaced below */ }
  const allow = useRoomAllowance(stake);

  // Settlement holdings, once the window is done.
  const [ref, setRef] = useState<BinaryRef | null>(null);
  const [held, setHeld] = useState<{ up: bigint; down: bigint } | null>(null);
  const settled = state?.status === 'Resolved' || state?.status === 'Voided';

  useEffect(() => {
    if (!room || !settled || !conn) return;
    let alive = true;
    void (async () => {
      try {
        const r = await adapter.ref(room.marketId);
        if (!r) return;
        const token = await adapter.publicClient.readContract({
          address: cfg.addresses.binarySettlement, abi: binarySettlementAbi, functionName: 'outcomeToken',
        }) as `0x${string}`;
        const read = (id: bigint) => adapter.publicClient.readContract({
          address: token, abi: erc6909Abi, functionName: 'balanceOf', args: [conn.account.address, id],
        }) as Promise<bigint>;
        const [up, down] = await Promise.all([read(r.upId), read(r.downId)]);
        if (alive) { setRef(r); setHeld({ up, down }); }
      } catch (e) { if (alive) setError(e); }
    })();
    return () => { alive = false; };
  }, [room, settled, conn, adapter, cfg.addresses.binarySettlement, hash]);

  if (!rooms) return <Readout title={`Room #${roomId}`}><p className="note err">No room escrow on this network.</p></Readout>;
  if (room === undefined) return <Readout title={`Room #${roomId}`}><Loading /></Readout>;
  if (room === null) return <Readout title={`Room #${roomId}`}><p className="note err">No such room{escrow ? ` at ${escrow.slice(0, 10)}…` : ''}.</p></Readout>;

  const run = (fn: () => Promise<{ txHash: string }>) => {
    setPending(true); setError(null);
    fn().then((r) => setHash(r.txHash))
      .catch((e) => setError(e))
      .finally(() => setPending(false));
  };

  // What a stake on each side would be worth if that side wins. This is the
  // whole difference from a duel, so it is on screen rather than implied.
  const pot = room.pot;
  const multiple = (sideTotal: bigint) =>
    sideTotal === 0n ? '—' : `${(Number(pot + stake) / Number(sideTotal + stake)).toFixed(2)}×`;

  const entryLeft = room.entryDeadline - now;
  const mine = seat ? seat.up + seat.down : 0n;

  // The same parts the game face is built from, in the same order: the question
  // strip, the window, then trays and keys. The create screen already reads this
  // way; a lobby that reads any other way makes one flow look like two products.
  const trend = state && state.spot >= state.strike ? 'up' : 'dn';
  const header = (
    <>
      {state && (
        <div className="window">
          <div className="crt">
            {/* The same scene the game face draws — this IS that window, and you
                have money on it. `side` is which half of the glass is yours, so
                the other animal is the one that comes for you. */}
            <MatchScreen
              state={state}
              side={seat && seat.up > 0n ? 'up' : seat && seat.down > 0n ? 'down' : null}
            />
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

      {/* Two facts, one row. The per-side totals used to live here too, and they
          are already printed on the keys below — a number said twice on one screen
          is a number the reader has to check against itself. */}
      <div className="order">
        <div className="trayrow">
          <div className="calc">
            <span>pot</span>
            <span className="lamp">{money.format(pot)}</span>
          </div>
          <div className="calc">
            <span>you</span>
            <span>
              {mine === 0n ? '—' : <>
                {seat && seat.up > 0n && <>{money.plain(seat.up)} up </>}
                {seat && seat.down > 0n && <>{money.plain(seat.down)} down</>}
              </>}
            </span>
          </div>
        </div>
      </div>
    </>
  );

  // ------------------------------------------------------------------ lobby
  if (!room.closed) {
    const canJoin = Boolean(conn) && stake > 0n && !pending && state?.status === 'Trading';
    const url = `${window.location.origin}${rooms.link(roomId)}`;

    return (
      <>
        {header}

        {/* Here the multiple IS your payout — it comes from the split in this
            room, not from a book that decides nothing. So unlike the create
            screen, it belongs on the key you are about to press. */}
        <div className="calls calls--pick">
          {(['up', 'down'] as const).map((sd) => (
            <Key key={sd} lit={side === sd} onPress={() => setSide(sd)}>
              <SideIcon side={sd} />
              <span className="nm">{sd.toUpperCase()}</span>
              <span className="mul">pays {multiple(sd === 'up' ? room.totalUp : room.totalDown)}</span>
            </Key>
          ))}
        </div>

        <div className="order">
          <label className="field field--inline">
            <span>stake ({money.symbol})</span>
            <input value={stakeStr} onChange={(e) => setStakeStr(e.target.value)} inputMode="decimal" />
          </label>
          <div className="calc">
            <span>entry closes in</span>
            <span>{Math.max(0, entryLeft)}s</span>
          </div>
        </div>

        <div className="calls calls--act">
          <Key onPress={onBack}><span className="nm">back</span></Key>
          {!conn ? (
            <Key lit disabled={connecting} onPress={doConnect}>
              <span className="nm">{connecting ? 'connecting…' : 'sign in'}</span>
            </Key>
          ) : (
            <Key lit={canJoin} disabled={!canJoin}
                 onPress={() => run(async () => {
                   // The approval rides along with the join rather than standing
                   // in front of it. See useRoomAllowance.ensure.
                   await allow.ensure(conn.wallet, conn.account, stake);
                   return rooms.join(conn.wallet, conn.account, roomId, side, stake);
                 })}>
              <span className="nm">
                {allow.approving ? 'approving…' : pending ? 'pending…' : `back ${side}`}
              </span>
            </Key>
          )}
        </div>

        <p className="hint">
          Any side, any size, until entry closes. The odds move as people pile in.
          {allow.enough === false && ' First join signs twice.'}
        </p>
        <div className="linkline">
          {/* The middle of a room link is an escrow address nobody reads. */}
          <code title={url}>{url.replace(/\/0x[0-9a-fA-F]{8}[0-9a-fA-F]+\//, '/0x…/')}</code>
          <button onClick={() => void navigator.clipboard.writeText(url)}>copy</button>
        </div>

        {error ? <Fault error={error} /> : null}
        {hash && <TxLine hash={hash} label="joined" />}
      </>
    );
  }

  // --------------------------------------------------- nobody took the other side
  if (room.oneSided) {
    return (
      <>
        {header}
        <p className="hint hint--warn">
          Everyone backed the same side, so there is nothing to win from. The stakes
          are merged back and everyone takes out exactly what they put in.
        </p>
        <div className="calls calls--act">
          <Key onPress={onBack}><span className="nm">back</span></Key>
          <Key lit={Boolean(conn) && mine > 0n && !seat?.settled}
               disabled={!conn || pending || mine === 0n || Boolean(seat?.settled)}
               onPress={() => conn && run(() => rooms.refund(conn.wallet, conn.account, roomId))}>
            <span className="nm">
              {pending ? 'pending…' : seat?.settled ? 'refunded' : `refund ${money.format(mine)}`}
            </span>
          </Key>
        </div>
        {error ? <Fault error={error} /> : null}
        {hash && <TxLine hash={hash} label="refunded" />}
      </>
    );
  }

  // ------------------------------------------------------------------ claim
  const claimable = seat ? seat.shareUp + seat.shareDown : 0n;
  // Everything still coming to this wallet, whichever half of the journey it is
  // sitting in. One number, so one key can be labelled with it.
  const owed = seat?.settled ? ((held?.up ?? 0n) + (held?.down ?? 0n)) : claimable;
  const settledMarket = settled && state;
  const voided = state?.status === 'Voided';
  const upWon = state ? state.spot > state.strike : false;

  /** Read what this wallet holds of the two outcome tokens, from the chain. */
  const readHeld = async (r: BinaryRef): Promise<{ up: bigint; down: bigint }> => {
    if (!conn) return { up: 0n, down: 0n };
    const token = await adapter.publicClient.readContract({
      address: cfg.addresses.binarySettlement, abi: binarySettlementAbi, functionName: 'outcomeToken',
    }) as `0x${string}`;
    const read = (id: bigint) => adapter.publicClient.readContract({
      address: token, abi: erc6909Abi, functionName: 'balanceOf', args: [conn.account.address, id],
    }) as Promise<bigint>;
    const [up, down] = await Promise.all([read(r.upId), read(r.downId)]);
    return { up, down };
  };

  /**
   * Take everything this wallet is owed, in one press.
   *
   * Underneath it is still two different things — claim moves your share of the
   * pot out of the escrow as outcome tokens, redeem turns a winning token into
   * collateral — and the contracts are right to keep them apart. But nobody
   * holding a winning ticket wants to be taught that distinction before they can
   * be paid, and a screen that shows Claim, waits, then reveals a second button
   * called Claim winnings reads as a machine that did not finish the job.
   *
   * Balances are read back from the chain between the steps rather than from the
   * effect's state: the tokens being redeemed are the ones the claim in this same
   * handler just produced, and that state does not exist yet.
   */
  const collect = async () => {
    if (!conn) return;
    setPending(true); setError(null);
    try {
      if (!seat?.settled && claimable > 0n) {
        const { txHash } = await rooms.claim(conn.wallet, conn.account, roomId);
        setHash(txHash);
      }
      // Nothing to redeem against until the market has an answer. The share is
      // out of the escrow and safe; the payout waits for settlement.
      if (!settledMarket) return;

      const r = ref ?? await adapter.ref(room.marketId);
      if (!r) return;
      setRef(r);
      const bal = await readHeld(r);

      // BinarySettlement, not the module: the module's redeem reverts once the
      // pool is released, and settlement pays against the outcome id itself.
      let paid = 0n;
      for (const [id, amount] of [[r.upId, bal.up], [r.downId, bal.down]] as const) {
        if (amount === 0n) continue;
        paid += amount;
        const { request } = await adapter.publicClient.simulateContract({
          account: conn.account, address: cfg.addresses.binarySettlement,
          abi: binarySettlementAbi, functionName: 'redeem',
          args: [id, amount, conn.account.address],
        });
        const tx = await conn.wallet.writeContract(request);
        await adapter.publicClient.waitForTransactionReceipt({ hash: tx });
        setHash(tx);
      }
      setHeld({ up: 0n, down: 0n });

      // The room knows both halves — what went in and what came out — so its
      // card can carry the multiple, which is the number people actually post.
      if (paid > 0n && mine > 0n) {
        const mult = Number(paid) / Number(mine);
        share?.({
          market: state ? `${state.symbol} · ${intervalLabel(state.intervalSec)}` : `Room #${roomId}`,
          side: seat && seat.up > 0n ? 'up' : 'down',
          payout: money.format(paid),
          stake: money.format(mine),
          multiple: `×${mult.toFixed(2)}`,
          net: `${paid >= mine ? '+' : ''}${money.plain(paid - mine)}`,
          strike: state ? price(state.strike) : undefined,
          close: state ? price(state.spot) : undefined,
        });
      }
    } catch (e) { setError(e); }
    finally { setPending(false); }
  };

  return (
    <>
      {header}

      {settledMarket && (
        <div className="order">
          <div className="calc">
            <span>result</span>
            <span className={voided ? 'lamp' : upWon ? 'up' : 'dn'}>
              {voided ? 'called off — both sides redeem half' : `${upWon ? 'UP' : 'DOWN'} took it`}
            </span>
          </div>
          <div className="calc">
            <span>oracle</span>
            <span>
              {state.oracleQuestionId
                ? <a href={oracleUrl(cfg, state.oracleQuestionId)} target="_blank" rel="noreferrer">oracle question</a>
                : 'none'}
            </span>
          </div>
        </div>
      )}

      {owed > 0n && (
        <p className="hint hint--warn">
          {settledMarket
            ? 'Winnings are not paid out automatically — a settled market pays only when asked.'
            : 'Your share of the pot is waiting in the escrow. Take it out now; it pays when the window settles.'}
        </p>
      )}

      {/* One key for the whole payout. What it has left to do decides its
          wording, not which of two screens you happen to be on. */}
      <div className="calls calls--act">
        <Key onPress={onBack}><span className="nm">back</span></Key>
        <Key lit={owed > 0n && Boolean(conn)} disabled={!conn || pending || owed === 0n}
             onPress={() => void collect()}>
          <span className="nm">
            {pending ? 'pending…'
              : owed === 0n ? 'nothing owed'
              : voided ? 'collect refund'
              : settledMarket ? `collect ${money.format(owed)}`
              : `claim ${money.format(owed)}`}
          </span>
        </Key>
      </div>

      {seat?.settled && !settledMarket && (
        <p className="hint">Claimed. The window is still running — come back when it settles.</p>
      )}
      {seat?.settled && settledMarket && held && held.up === 0n && held.down === 0n && (
        <p className="hint">Nothing left on this leg.</p>
      )}
      {mine === 0n && <p className="hint">You are not in this room.</p>}

      {error ? <Fault error={error} /> : null}
      {hash && <TxLine hash={hash} />}
    </>
  );
}
