import { useMarkets, useNow } from '../../sdk';
import { Readout } from '../components/Readout';

/** The market card. Replaces the plain S2 table with plaques set into the
 *  plate — real markets from the indexer, not the console's simulation. */
export function MarketsPanel({ onPick }: { onPick: (marketId: string) => void }) {
  const { markets, error, loading } = useMarkets();
  const now = useNow();

  const live = markets.filter((m) => m.status === 'Trading');

  return (
    <Readout title="Markets" right={loading ? 'reading…' : `${live.length} live`}>
      {error && <p className="note err">{error}</p>}
      {!error && !loading && !live.length && (
        <p className="note warn">No market is Trading right now. The venue rolls windows on a schedule.</p>
      )}

      <div className="picker">
        {live.map((m) => {
          const left = Math.max(0, m.expiryTime - now);
          const up = Math.round(m.upPrice * 100);
          return (
            // Gotcha §8.6 — keyed by marketId. Pools are recycled across windows.
            <button key={m.marketId} className="picker__row" onClick={() => onPick(m.marketId)}>
              <span className="sym">{m.symbol} · {m.intervalSec}s</span>
              <span className="odds">{up}% / {100 - up}%</span>
              <span className="meta">
                strike {m.strike || '—'} · spot {m.spot || '—'}
              </span>
              <span className="ends">{Math.floor(left / 60)}m {left % 60}s</span>
            </button>
          );
        })}
      </div>
    </Readout>
  );
}
