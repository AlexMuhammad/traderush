import { useEffect, useState } from 'react';
import { binarySettlementAbi } from '@bullrun/sdk';
import { formatUnits } from 'viem';
import { useSdk } from '../../sdk';
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
  cursor, onCursor, bindSelect,
}: {
  cursor: number;
  onCursor: (i: number) => void;
  bindSelect?: (fire: () => void) => void;
}) {
  const { cfg, market } = useSdk();
  const { conn } = useWallet();
  const [rows, setRows] = useState<Claimable[] | null>(null);
  const [held, setHeld] = useState<ScreenItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(0);

  const money = (v: bigint) => `${formatUnits(v, cfg.decimals)} ${cfg.collateralSymbol}`;

  useEffect(() => {
    if (!conn) return;
    let alive = true;
    void (async () => {
      try {
        const client = market.discovery.client;
        const [claimable, portfolio] = await Promise.all([
          client.getClaimable(conn.account.address),
          client.getPortfolio(conn.account.address),
        ]);
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

        // Everything still open, so a position is visible before it settles.
        const openIds = new Set(named.map((c) => c.marketId.toLowerCase()));
        setHeld(portfolio.positions
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
    } catch (e) {
      setError(e);
    } finally { setBusy(null); }
  };

  const claimRows: ScreenItem[] = (rows ?? []).map((r) => ({
    key: r.marketId,
    label: `${r.label} ${r.outcomeIdx === 0 ? 'UP' : 'DOWN'}`,
    right: money(r.estPayout),
    meta: busy === r.marketId ? 'claiming…' : 'claim',
    sub: 'settled and owed to you — nothing pays out until you ask',
    disabled: busy !== null,
  }));

  const items = [...claimRows, ...held];

  return (
    <ScreenList
      title="Positions"
      right={!conn ? 'no wallet' : rows === null ? 'reading…' : `${claimRows.length} claimable`}
      items={items}
      cursor={cursor}
      onCursor={onCursor}
      bindSelect={bindSelect}
      loading={Boolean(conn) && rows === null && !error}
      onSelect={(i) => {
        const row = (rows ?? []).find((r) => r.marketId === i.key);
        if (row) void claim(row);
      }}
      empty={error ? <Fault error={error} /> : ((!conn ? 'Connect a wallet to see your positions.'
                             : 'Nothing held and nothing owed.'))}
    />
  );
}
