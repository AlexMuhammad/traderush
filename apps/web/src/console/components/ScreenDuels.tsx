import { useEffect, useState } from 'react';
import type { DuelView } from '@bullrun/sdk';
import { useSdk } from '../../sdk';
import { useWallet } from '../../walletContext';
import { useMoney } from './money';
import { ScreenList, type ScreenItem } from './ScreenList';

/** Your duels, read straight off the escrow.
 *
 *  The escrow keeps no per-player index — adding one would charge every opener
 *  gas to serve this screen — so the client scans instead. Reads are free. */
export function ScreenDuels({
  cursor, onCursor, bindSelect, onOpen,
}: {
  cursor: number;
  onCursor: (i: number) => void;
  bindSelect?: (fire: () => void) => void;
  onOpen: (duelId: bigint) => void;
}) {
  const { duels } = useSdk();
  const { conn } = useWallet();
  const money = useMoney();
  const [rows, setRows] = useState<DuelView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!duels || !conn) return;
    let alive = true;
    const load = () => duels.listFor(conn.account.address)
      .then((r) => { if (alive) { setRows(r); setError(null); } })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    load();
    const t = setInterval(load, 6_000);
    return () => { alive = false; clearInterval(t); };
  }, [duels, conn]);

  const me = conn?.account.address.toLowerCase();
  const items: ScreenItem[] = (rows ?? []).map((d) => {
    const mine = d.challenger.toLowerCase() === me;
    const side = mine ? d.challengerUp : !d.challengerUp;
    return {
      key: String(d.id),
      label: `#${d.id} ${side ? 'UP' : 'DOWN'}`,
      right: money.plain(d.stake),
      meta: d.status === 'Open' && d.expired ? 'expired' : d.status.toLowerCase(),
      sub: <>pot {money.format(d.pot)} · {mine ? 'you opened it' : 'you accepted it'}</>,
    };
  });

  return (
    <ScreenList
      title="My duels"
      right={!conn ? 'no wallet' : rows === null ? 'reading…' : `${items.length}`}
      items={items}
      cursor={cursor}
      onCursor={onCursor}
      bindSelect={bindSelect}
      onSelect={(i) => onOpen(BigInt(i.key))}
      loading={Boolean(conn) && rows === null && !error}
      empty={
        error ?? (!conn ? 'Connect a wallet to see your duels.'
                        : !duels ? 'No escrow deployed on this network.'
                        : 'No duels yet. Open one from Markets.')
      }
    />
  );
}
