import { useEffect, useState } from 'react';
import { binarySettlementAbi } from '@traderush/sdk';
import { formatUnits } from 'viem';
import { useSdk } from '../../sdk';
import { withTimeout } from '../../timeout';
import type { WinCard } from '../share/winCard';
import { useWallet } from '../../walletContext';
import { intervalLabel } from '../engine/market';
import { Fault } from './Readout';
import { ScreenList, type ScreenItem } from './ScreenList';

interface Claimable {
  marketId: string;
  outcomeIdx: 0 | 1;
  amount: bigint;
  estPayout: bigint;
  label: string;
}

/**
 * Outcome tokens you hold, and what is owed to you.
 *
 * The second half matters more than it sounds. A settled market leaves the live
 * list, so unclaimed winnings look like no winnings at all (gotcha §8.8) — and
 * nothing pays out until someone asks. This is where you ask.
 */
export function ScreenPositions({
  cursor, onCursor, bindSelect, onWin,
}: {
  cursor: number;
  onCursor: (i: number) => void;
  bindSelect?: (fire: () => void) => void;
  /** Fired the moment a claim lands. Getting paid is the moment worth showing
   *  off — asking someone to go and find a share button afterwards is asking
   *  them to do it later, which means never. */
  onWin?: (card: WinCard) => void;
}) {
  const { cfg, market } = useSdk();
  const { conn } = useWallet();
  const [rows, setRows] = useState<Claimable[] | null>(null);
  const [held, setHeld] = useState<ScreenItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(0);
  const [heldFailed, setHeldFailed] = useState(false);
  /**
   * What this session has actually redeemed, and the card for each.
   *
   * Held here rather than read back from the indexer, for two reasons. The
   * indexer lags a redeem by however long it takes to index it, so a claimed row
   * kept saying "claim" and invited a second, pointless signature. And once it
   * does catch up the row disappears entirely — taking the card with it, at the
   * exact moment someone might want to post it.
   */
  const [claimed, setClaimed] = useState<Map<string, WinCard>>(new Map());

  const money = (v: bigint) => `${formatUnits(v, cfg.decimals)} ${cfg.collateralSymbol}`;

  useEffect(() => {
    if (!conn) return;
    let alive = true;
    void (async () => {
      try {
        const client = market.discovery.client;
        // Settled, not all: these are two independent questions, and the
        // portfolio half of the indexer can hang indefinitely. Under Promise.all
        // that took the answered half down with it and left the screen on its
        // loading lamps forever — the report this was written to fix.
        const [claim, port] = await Promise.allSettled([
          withTimeout(client.getClaimable(conn.account.address), 9000, 'the indexer'),
          withTimeout(client.getPortfolio(conn.account.address), 9000, 'the indexer'),
        ]);
        if (!alive) return;

        // What is owed is the half that matters; if it failed there is nothing
        // worth showing and the error says so.
        if (claim.status === 'rejected') throw claim.reason;
        const claimable = claim.value;

        const named = await Promise.all(claimable.map(async (c) => {
          const m = await market.discovery.get(c.marketId).catch(() => null);
          return {
            marketId: c.marketId,
            outcomeIdx: c.outcomeIdx,
            amount: c.amount,
            estPayout: c.estPayout,
            label: m ? `${m.symbol} ${intervalLabel(m.intervalSec)}` : c.marketId.slice(0, 10),
          };
        }));
        if (!alive) return;
        setRows(named);

        // The open positions are the nice-to-have. Losing them costs a list of
        // things you already know you hold; losing the screen costs the claim
        // button, which is the only way money comes back.
        if (port.status === 'rejected') { setHeldFailed(true); return; }
        setHeldFailed(false);

        // Everything still open, so a position is visible before it settles.
        const openIds = new Set(named.map((c) => c.marketId.toLowerCase()));
        setHeld(port.value.positions
          .filter((p) => BigInt(p.balance) > 0n && !openIds.has(p.market.id.toLowerCase()))
          .map((p) => ({
            key: `${p.market.id}:${p.outcomeIndex}`,
            label: `${p.market.asset} ${intervalLabel(Number(p.market.intervalSec ?? 0))}`,
            right: p.outcomeIndex === 0 ? 'UP' : 'DOWN',
            meta: formatUnits(BigInt(p.balance), p.market.quoteDecimals),
            sub: `${p.market.status.toLowerCase()} · strike ${p.market.strike}`,
            disabled: true,
          })));
      } catch (e) {
        if (alive) setError(e);
      }
    })();
    return () => { alive = false; };
  }, [conn, market, done]);

  const claim = async (row: Claimable) => {
    if (!conn) return;
    setBusy(row.marketId); setError(null);
    try {
      const ref = await market.ref(row.marketId);
      if (!ref) throw new Error('market not in the indexer');
      const outcomeToken = await market.publicClient.readContract({
        address: cfg.addresses.binarySettlement, abi: binarySettlementAbi, functionName: 'outcomeToken',
      }) as `0x${string}`;
      void outcomeToken;
      // BinarySettlement, not the module: the module's redeem reverts once the
      // pool is released, and settlement pays against the outcome id itself.
      const { request } = await market.publicClient.simulateContract({
        account: conn.account, address: cfg.addresses.binarySettlement,
        abi: binarySettlementAbi, functionName: 'redeem',
        args: [row.outcomeIdx === 0 ? ref.upId : ref.downId, row.amount, conn.account.address],
      });
      const hash = await conn.wallet.writeContract(request);
      await market.publicClient.waitForTransactionReceipt({ hash });
      setDone((n) => n + 1);
      const card: WinCard = {
        market: row.label,
        side: row.outcomeIdx === 0 ? 'up' : 'down',
        payout: money(row.estPayout),
      };
      setClaimed((m) => new Map(m).set(row.marketId, card));
      onWin?.(card);
    } catch (e) {
      setError(e);
    } finally { setBusy(null); }
  };

  // Owed, minus anything this session already took.
  const owed = (rows ?? []).filter((r) => !claimed.has(r.marketId));

  const claimRows: ScreenItem[] = owed.map((r) => ({
    key: r.marketId,
    label: `${r.label} ${r.outcomeIdx === 0 ? 'UP' : 'DOWN'}`,
    right: money(r.estPayout),
    meta: busy === r.marketId ? 'claiming…' : 'claim',
    sub: 'settled and owed to you — nothing pays out until you ask',
    disabled: busy !== null,
  }));

  // Paid, and still pressable: the card is the reason to come back to the row.
  const paidRows: ScreenItem[] = [...claimed.entries()].map(([marketId, card]) => ({
    key: marketId,
    label: `${card.market} ${card.side === 'up' ? 'UP' : 'DOWN'}`,
    right: card.payout,
    meta: 'card',
    sub: 'paid out — open the card to share it',
  }));

  const items: ScreenItem[] = [
    ...claimRows,
    ...paidRows,
    ...held,
    // Said as a row rather than swallowed: an absent list and a list that could
    // not be fetched look identical and mean opposite things.
    ...(heldFailed
      ? [{
          key: '__held-failed',
          label: 'Open positions unavailable',
          sub: 'the indexer did not answer — anything owed to you is still listed above',
          disabled: true,
        }]
      : []),
  ];

  return (
    <ScreenList
      title="Positions"
      right={!conn ? 'no wallet' : rows === null ? 'reading…'
        : claimRows.length ? `${claimRows.length} claimable` : `${paidRows.length} paid`}
      items={items}
      cursor={cursor}
      onCursor={onCursor}
      bindSelect={bindSelect}
      loading={Boolean(conn) && rows === null && !error}
      onSelect={(i) => {
        // A row you already took opens its card again rather than asking the
        // chain a second time for money it has already sent.
        const card = claimed.get(i.key);
        if (card) { onWin?.(card); return; }
        const row = owed.find((r) => r.marketId === i.key);
        if (row) void claim(row);
      }}
      empty={error ? <Fault error={error} /> : ((!conn ? 'Connect a wallet to see your positions.'
                             : 'Nothing held and nothing owed.'))}
    />
  );
}
