import { useEffect, useState } from 'react';
import type { DuelView } from '@traderush/sdk';
import { useSdk } from '../../sdk';
import { useWallet } from '../../walletContext';
import { useMoney } from './money';
import { Fault } from './Readout';
import { ScreenList, type ScreenItem } from './ScreenList';

/** Duels that are over — settled, or refunded because nobody took them.
 *  My duels shows what is still running; this is the record. */
export function ScreenHistory({
  cursor, onCursor, bindSelect, onOpen,
}: {
  cursor: number;
  onCursor: (i: number) => void;
  bindSelect?: (fire: () => void) => void;
  onOpen: (duelId: bigint) => void;
}) {
  const { duels, market } = useSdk();
  const { conn } = useWallet();
  const money = useMoney();
  const [rows, setRows] = useState<{ duel: DuelView; result: string; tone?: 'up' | 'dn' }[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!duels || !conn) return;
    let alive = true;
    void (async () => {
      try {
        const mine = await duels.listFor(conn.account.address);
        const me = conn.account.address.toLowerCase();
        const out: { duel: DuelView; result: string; tone?: 'up' | 'dn' }[] = [];

        for (const d of mine) {
          if (d.status === 'Cancelled') { out.push({ duel: d, result: 'refunded' }); continue; }
          if (d.status !== 'Matched') continue;
          const m = await market.discovery.get(d.marketId).catch(() => null);
          if (!m || (m.status !== 'Resolved' && m.status !== 'Voided')) continue;

          if (m.status === 'Voided') { out.push({ duel: d, result: 'called off' }); continue; }
          const upWon = m.spot > m.strike;
          const iAmChallenger = d.challenger.toLowerCase() === me;
          const mySideUp = iAmChallenger ? d.challengerUp : !d.challengerUp;
          const won = mySideUp === upWon;
          out.push({ duel: d, result: won ? `won ${money.plain(d.pot)}` : `lost ${money.plain(d.stake)}`, tone: won ? 'up' : 'dn' });
        }
        if (alive) setRows(out);
      } catch (e) {
        if (alive) setError(e);
      }
    })();
    return () => { alive = false; };
  }, [duels, conn, market, money]);

  const items: ScreenItem[] = (rows ?? []).map(({ duel, result, tone }) => ({
    key: String(duel.id),
    label: `#${duel.id}`,
    right: <span className={tone}>{result}</span>,
    meta: money.plain(duel.stake),
    sub: `${duel.challengerUp ? 'challenger UP' : 'challenger DOWN'} · pot ${money.format(duel.pot)}`,
  }));

  return (
    <ScreenList
      title="History"
      right={!conn ? 'no wallet' : rows === null ? 'reading…' : `${items.length}`}
      items={items}
      cursor={cursor}
      onCursor={onCursor}
      bindSelect={bindSelect}
      onSelect={(i) => onOpen(BigInt(i.key))}
      loading={Boolean(conn) && rows === null && !error}
      empty={error ? <Fault error={error} /> : ((!conn ? 'Connect a wallet.' : 'Nothing finished yet.'))}
    />
  );
}
