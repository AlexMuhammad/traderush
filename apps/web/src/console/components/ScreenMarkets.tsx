import { useMarkets, useNow } from '../../sdk';
import { intervalLabel } from '../engine/market';

/** The market list, drawn ON the CRT.
 *
 *  Rows rather than cards: this is an instrument listing what it can tune to,
 *  and the scanline overlay falls across it so it reads as phosphor. */
export function ScreenMarkets({
  currentMarketId, onPick,
}: {
  currentMarketId: string;
  onPick: (marketId: string) => void;
}) {
  const { markets, error, loading } = useMarkets();
  const now = useNow();

  const live = markets
    .filter((m) => m.status === 'Trading')
    .sort((a, b) => a.intervalSec - b.intervalSec || a.symbol.localeCompare(b.symbol));

  return (
    <div className="screen">
      <div className="screen__bar">
        <span>Markets</span>
        <em>{loading ? 'scanning…' : `${live.length} live`}</em>
      </div>

      <div className="screen__body">
        {error && <div className="screen__empty">{error}</div>}
        {!error && !loading && !live.length && (
          <div className="screen__empty">No market is trading.<br />The venue rolls windows on a schedule.</div>
        )}

        {live.map((m) => {
          const left = Math.max(0, m.expiryTime - now);
          const up = Math.round(m.upPrice * 100);
          const above = m.spot >= m.strike;
          return (
            <button
              key={m.marketId}
              className={`scanrow${m.marketId === currentMarketId ? ' tuned' : ''}`}
              onClick={() => onPick(m.marketId)}
            >
              <span className="name">{m.symbol} {intervalLabel(m.intervalSec)}</span>
              <span className="odds">
                <span className="up">{up}</span>/<span className="dn">{100 - up}</span>
              </span>
              <span className="left">
                {left >= 3600 ? `${Math.floor(left / 3600)}h${Math.floor((left % 3600) / 60)}m`
                              : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`}
              </span>
              <span className="sub">
                strike {m.strike || '—'} · spot {m.spot || '—'}
                {' · '}
                <span className={above ? 'up' : 'dn'}>{above ? 'UP ahead' : 'DOWN ahead'}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
