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

/**
 * How long the claim list is given before the screen gives up on it.
 *
 * Generous, because nothing waits on it. `getClaimable` is documented by the
 * SDK as "one portfolio read plus one fee read per winning market", and those
 * fee reads are sequential — an account with seventy claimable markets was
 * measured at seventy-one requests and sixty-six seconds. Cutting that off at
 * nine seconds, and then at thirty, only ever replaced a slow answer with a
 * failure; the request kept running either way.
 *
 * Still bounded, because an unbounded wait is what `withTimeout` exists to
 * prevent: a screen on its lamps forever cannot be told from a broken one.
 * This is set past what the slowest account measured, not at it.
 */
const CLAIMABLE_BUDGET = 120_000;

/** The open positions get a short one, and can afford to: nothing waits on
 *  them either, and on this indexer that half regularly never answers at all.
 *  Failing fast here just puts the "unavailable" row up sooner. */
const PORTFOLIO_BUDGET = 9_000;

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
  /** Open positions, with the market kept alongside so the claim list can be
   *  subtracted at render — the two halves now arrive in either order. */
  const [heldRaw, setHeldRaw] = useState<(ScreenItem & { marketId: string })[]>([]);
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
    const client = market.discovery.client;
    const acct = conn.account.address;

    // Neither half blocks the screen, and neither waits for the other.
    //
    // The claim list is the expensive one, and not because of its size. The SDK
    // documents `getClaimable` as "one portfolio read plus one fee read per
    // winning market", and those fee reads go out one after another: measured
    // against an account with seventy claimable markets it made seventy-one
    // requests and took sixty-six seconds. A timeout cannot fix a shape like
    // that. It can only choose how early to give up, which is all the thirty
    // seconds here ever did — and giving up printed a failure for an answer
    // that was still coming.
    //
    // Those fee reads buy `estPayout`, and `estPayout` is a label. The claim is
    // sent with `outcomeIdx` and `amount`, neither of which waits on a fee. So
    // this is worth waiting for in the background and never worth holding the
    // screen for.
    void withTimeout(client.getClaimable(acct), CLAIMABLE_BUDGET, 'the indexer')
      .then(async (claimable) => {
        if (!alive) return;
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
        setError(null);
      })
      .catch((e) => { if (alive) setError(e); });

    // The open positions are the nice-to-have. Losing them costs a list of
    // things you already know you hold; losing the screen costs the claim
    // button, which is the only way money comes back.
    void withTimeout(client.getPortfolio(acct), PORTFOLIO_BUDGET, 'the indexer')
      .then((port) => {
        if (!alive) return;
        setHeldFailed(false);
        // Everything still open, so a position is visible before it settles.
        // What is already owed is subtracted at RENDER rather than here: the
        // two halves now land in whichever order the indexer decides them, and
        // this one usually wins.
        setHeldRaw(port.positions
          .filter((p) => BigInt(p.balance) > 0n)
          .map((p) => ({
            key: `${p.market.id}:${p.outcomeIndex}`,
            marketId: p.market.id,
            label: `${p.market.asset} ${intervalLabel(Number(p.market.intervalSec ?? 0))}`,
            right: p.outcomeIndex === 0 ? 'UP' : 'DOWN',
            meta: formatUnits(BigInt(p.balance), p.market.quoteDecimals),
            sub: `${p.market.status.toLowerCase()} · strike ${p.market.strike}`,
            disabled: true,
          })));
      })
      .catch(() => { if (alive) setHeldFailed(true); });

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

  // A market that is already listed as owed must not also be listed as open.
  // Subtracted here rather than where the positions are fetched, because the
  // claim list is the slower of the two and usually is not there yet.
  const owedIds = new Set((rows ?? []).map((r) => r.marketId.toLowerCase()));
  const held: ScreenItem[] = heldRaw
    .filter((h) => !owedIds.has(h.marketId.toLowerCase()))
    .map(({ marketId: _m, ...item }) => item);

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
