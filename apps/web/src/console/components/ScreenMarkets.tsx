import { useMarkets, useNow } from '../../sdk';
import { intervalLabel } from '../engine/market';
import { ScreenList, type ScreenItem } from './ScreenList';

const clock = (s: number) =>
  s >= 3600 ? `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`
            : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Every live market, on the glass. Sorted shortest window first — those are
 *  the ones you can actually watch resolve. */
export function ScreenMarkets({
  title, currentMarketId, cursor, onCursor, onPick, bindSelect,
}: {
  title: string;
  currentMarketId: string;
  cursor: number;
  onCursor: (i: number) => void;
  bindSelect?: (fire: () => void) => void;
  onPick: (marketId: string) => void;
}) {
  const { markets, error, loading } = useMarkets();
  const now = useNow();

  const live = markets
    .filter((m) => m.status === 'Trading')
    .sort((a, b) => a.intervalSec - b.intervalSec || a.symbol.localeCompare(b.symbol));

  const items: ScreenItem[] = live.map((m) => {
    const left = Math.max(0, m.expiryTime - now);
    const up = Math.round(m.upPrice * 100);
    const above = m.spot >= m.strike;
    return {
      key: m.marketId,
      label: `${m.symbol} ${intervalLabel(m.intervalSec)}`,
      right: <><span className="up">{up}</span>/<span className="dn">{100 - up}</span></>,
      meta: clock(left),
      sub: <>strike {m.strike || '—'} · spot {m.spot || '—'} · <span className={above ? 'up' : 'dn'}>{above ? 'UP ahead' : 'DOWN ahead'}</span></>,
      current: m.marketId === currentMarketId,
    };
  });

  return (
    <ScreenList
      title={title}
      right={error ? 'error' : loading ? 'scanning…' : `${live.length} live`}
      items={items}
      cursor={cursor}
      onCursor={onCursor}
      bindSelect={bindSelect}
      onSelect={(i) => onPick(i.key)}
      empty={error ?? 'No market is trading. The venue rolls windows on a schedule.'}
    />
  );
}
