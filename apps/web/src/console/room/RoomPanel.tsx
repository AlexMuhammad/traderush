import { useEffect, useState } from 'react';
import { binarySettlementAbi, erc6909Abi, oracleUrl, type BinaryRef } from '@bullrun/sdk';
import { useMarket, useNow, useRoom, useSdk, useSeat } from '../../sdk';
import { useWallet } from '../../walletContext';
import { useMoney } from '../components/money';
import { Key } from '../components/Key';
import { SideIcon } from '../components/SideIcon';
import { Loading, Fault, Readout, Row, Rows, TxLine } from '../components/Readout';
import { Trail } from '../components/Trail';
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

  const header = (
    <>
      {state && <Trail state={state} />}
      <Rows>
        <Row label="market">
          {state ? `${state.symbol} · ${intervalLabel(state.intervalSec)} · strike ${price(state.strike)} · spot ${price(state.spot)}` : 'reading…'}
        </Row>
        <Row label="pot" tone="lamp">{money.format(pot)}</Row>
        <Row label="up" tone="up">
          {money.plain(room.totalUp)} · pays {multiple(room.totalUp)}
        </Row>
        <Row label="down" tone="dn">
          {money.plain(room.totalDown)} · pays {multiple(room.totalDown)}
        </Row>
        {mine > 0n && seat && (
          <Row label="you">
            {seat.up > 0n && <>{money.plain(seat.up)} up </>}
            {seat.down > 0n && <>{money.plain(seat.down)} down</>}
          </Row>
        )}
      </Rows>
    </>
  );

  // ------------------------------------------------------------------ lobby
  if (!room.closed) {
    const canJoin = Boolean(conn) && stake > 0n && !pending && state?.status === 'Trading';
    const url = `${window.location.origin}${rooms.link(roomId)}`;

    return (
      <Readout title={`Room #${roomId}`} right={`entry closes in ${Math.max(0, entryLeft)}s`}>
        {header}

        <div className="calls" style={{ marginTop: 11 }}>
          {(['up', 'down'] as const).map((sd) => (
            <Key key={sd} lit={side === sd} onPress={() => setSide(sd)}>
              <SideIcon side={sd} />
              <span className="nm">{sd.toUpperCase()}</span>
              <span className="mul">{multiple(sd === 'up' ? room.totalUp : room.totalDown)}</span>
            </Key>
          ))}
        </div>

        <label className="field">
          <span>stake ({money.symbol})</span>
          <input value={stakeStr} onChange={(e) => setStakeStr(e.target.value)} inputMode="decimal" />
        </label>

        {!conn ? (
          <Key className="action" disabled={connecting} onPress={doConnect}>
            {connecting ? 'connecting…' : 'Sign in to join'}
          </Key>
        ) : (
          <Key className="action" disabled={!canJoin}
               onPress={() => run(async () => {
                 // The approval rides along with the join rather than standing
                 // in front of it. See useRoomAllowance.ensure.
                 await allow.ensure(conn.wallet, conn.account, stake);
                 return rooms.join(conn.wallet, conn.account, roomId, side, stake);
               })}>
            {allow.approving ? 'approving…'
              : pending ? 'pending…'
              : `Back ${side.toUpperCase()} with ${money.format(stake)}`}
          </Key>
        )}

        <p className="note">
          Join as many times as you like, either side, until entry closes. The odds above
          move as people pile in.
          {allow.enough === false && ' Your first join on this wallet signs twice: permission, then the join.'}
        </p>
        <div className="linkline">
          <code>{url}</code>
          <button onClick={() => void navigator.clipboard.writeText(url)}>copy</button>
        </div>

        {error ? <Fault error={error} /> : null}
        {hash && <TxLine hash={hash} label="joined" />}
        <Key className="action" onPress={onBack}>Back</Key>
      </Readout>
    );
  }

  // --------------------------------------------------- nobody took the other side
  if (room.oneSided) {
    return (
      <Readout title={`Room #${roomId}`} right="uncontested">
        {header}
        <p className="note warn">
          Everyone backed the same side, so there is nothing to win from. The stakes are
          merged back and everyone takes out exactly what they put in.
        </p>
        <Key className="action"
             disabled={!conn || pending || mine === 0n || Boolean(seat?.settled)}
             onPress={() => conn && run(() => rooms.refund(conn.wallet, conn.account, roomId))}>
          {pending ? 'pending…' : seat?.settled ? 'refunded' : `Refund ${money.format(mine)}`}
        </Key>
        {error ? <Fault error={error} /> : null}
        {hash && <TxLine hash={hash} label="refunded" />}
        <Key className="action" onPress={onBack}>Back</Key>
      </Readout>
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
      for (const [id, amount] of [[r.upId, bal.up], [r.downId, bal.down]] as const) {
        if (amount === 0n) continue;
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
    } catch (e) { setError(e); }
    finally { setPending(false); }
  };

  return (
    <Readout title={`Room #${roomId}`} right={settledMarket ? (voided ? 'called off' : 'settled') : 'running'}>
      {header}

      {settledMarket && (
        <Rows>
          {voided
            ? <Row label="result" tone="lamp">called off — both sides redeem half</Row>
            : <Row label="result" tone={upWon ? 'up' : 'dn'}>{upWon ? 'UP' : 'DOWN'} took it</Row>}
          <Row label="oracle">
            {state.oracleQuestionId
              ? <a href={oracleUrl(cfg, state.oracleQuestionId)} target="_blank" rel="noreferrer">oracle question</a>
              : 'none'}
          </Row>
        </Rows>
      )}

      {/* One key for the whole payout. What it has left to do decides its
          wording, not which of two screens you happen to be on. */}
      {owed > 0n && (
        <>
          <p className="note warn">
            {settledMarket
              ? 'Winnings are not paid out automatically — a settled market pays only when asked.'
              : 'Your share of the pot is waiting in the escrow. Take it out now; it pays when the window settles.'}
          </p>
          <Key className="action" disabled={!conn || pending} onPress={() => void collect()}>
            {pending ? 'pending…'
              : voided ? 'Collect refund'
              : settledMarket ? `Collect ${money.format(owed)}`
              : `Claim ${money.format(owed)}`}
          </Key>
        </>
      )}

      {seat?.settled && !settledMarket && (
        <p className="note">
          Claimed. The window is still running — come back when it settles.
        </p>
      )}
      {seat?.settled && settledMarket && held && held.up === 0n && held.down === 0n && (
        <p className="note">Nothing left on this leg.</p>
      )}
      {mine === 0n && <p className="note">You are not in this room.</p>}

      {error ? <Fault error={error} /> : null}
      {hash && <TxLine hash={hash} />}
      <Key className="action" onPress={onBack}>Back</Key>
    </Readout>
  );
}
