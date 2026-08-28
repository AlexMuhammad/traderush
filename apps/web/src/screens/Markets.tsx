import { useMarkets, useNow } from '../sdk';
import { StatusBadge } from '../components/ui';

/** S2 — Markets. Live table of event-contract markets. Row click → S3. */
export function Markets({ navigate }: { navigate: (to: string) => void }) {
  const { markets, error, loading } = useMarkets();
  const now = useNow();

  if (loading) return <p className="muted">loading markets…</p>;
  if (error) return <p className="err">markets unavailable: {error}</p>;
  if (!markets.length) return <p className="muted">no markets returned by GET /v0/markets</p>;

  return (
    <section id="markets">
      <h2>Markets</h2>
      <table>
        <thead>
          <tr>
            <th>asset</th><th>interval</th><th>strike</th><th>spot</th>
            <th>up</th><th>down</th><th>status</th><th>expires in</th>
          </tr>
        </thead>
        <tbody>
          {markets.map((m) => {
            const left = m.expiryTime ? m.expiryTime - now : 0;
            return (
              // Gotcha §8.6 — keyed by marketId. Pools are recycled across windows.
              <tr key={m.marketId} role="button" tabIndex={0}
                  onClick={() => navigate(`/market/${m.marketId}`)}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(`/market/${m.marketId}`)}>
                <td>{m.symbol}</td>
                <td>{m.intervalSec ? `${m.intervalSec}s` : '—'}</td>
                <td>{m.strike || '—'}</td>
                <td>{m.spot || '—'}</td>
                <td>{m.upPrice ? m.upPrice.toFixed(3) : '—'}</td>
                <td>{m.upPrice ? (1 - m.upPrice).toFixed(3) : '—'}</td>
                <td><StatusBadge status={m.status} /></td>
                <td>{left > 0 ? `${Math.floor(left / 60)}m ${left % 60}s` : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted">Only <code>Trading</code> accepts orders and mints (§2).</p>
    </section>
  );
}
