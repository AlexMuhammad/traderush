import { useEffect, useState } from 'react';
import type { Room, Seat } from '@traderush/sdk';
import { apiRooms } from '../../api';
import { useNow, useSdk } from '../../sdk';
import { useWallet } from '../../walletContext';
import { useMoney } from './money';
import { Fault } from './Readout';
import { ScreenList, type ScreenItem } from './ScreenList';

/** Rooms you are in. The escrow keeps no per-player index — adding one would
 *  charge every opener gas to serve a screen — so the client scans. */
export function ScreenRooms({
  cursor, onCursor, bindSelect, onOpen,
}: {
  cursor: number;
  onCursor: (i: number) => void;
  bindSelect?: (fire: () => void) => void;
  onOpen: (roomId: bigint) => void;
}) {
  const { rooms, roomsError } = useSdk();
  const { conn } = useWallet();
  const money = useMoney();
  const now = useNow();
  const [list, setList] = useState<{ room: Room; seat: Seat }[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!rooms || !conn) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    // Scheduled from the end of the last poll, not on a fixed tick: a slow
    // answer must not have a second request stacked on top of it.
    const load = () => apiRooms(conn.account.address)
      .catch(() => rooms.listFor(conn.account.address))
      .then((r) => { if (alive) { setList(r); setError(null); } })
      .catch((e) => { if (alive) setError(e); })
      .finally(() => { if (alive) timer = setTimeout(load, 6_000); });
    load();
    return () => { alive = false; clearTimeout(timer); };
  }, [rooms, conn]);

  const items: ScreenItem[] = (list ?? []).map(({ room, seat }) => {
    const left = room.entryDeadline - now;
    const status = !room.closed ? `${Math.max(0, left)}s to join`
      : room.oneSided ? 'uncontested'
      : seat.settled ? 'claimed' : 'claim';
    return {
      key: String(room.id),
      label: `#${room.id}`,
      right: money.plain(room.pot),
      meta: status,
      sub: <>
        <span className="up">{money.plain(room.totalUp)} up</span>
        {' / '}
        <span className="dn">{money.plain(room.totalDown)} down</span>
        {' · you '}{money.plain(seat.up + seat.down)}
      </>,
    };
  });

  return (
    <ScreenList
      title="My rooms"
      right={!conn ? 'no wallet' : list === null ? 'reading…' : `${items.length}`}
      items={items}
      cursor={cursor}
      onCursor={onCursor}
      bindSelect={bindSelect}
      onSelect={(i) => onOpen(BigInt(i.key))}
      loading={Boolean(conn) && list === null && !error}
      empty={
        error ? <Fault error={error} /> : roomsError ?? (!conn ? 'Connect a wallet to see your rooms.'
                                      : 'No rooms yet. Open one from Markets.')
      }
    />
  );
}
