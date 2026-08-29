import { useMemo } from 'react';
import type { MarketState } from '@bullrun/sdk';
import { useMarketTrail } from '../../sdk';
import { price } from '../engine/market';

const W = 380;
const H = 96;
const PAD = 6;

/**
 * The window's price shape, for the screens where someone picks a side.
 *
 * A panel that asks "up or down" while showing only two numbers is asking blind
 * — the strike and the spot say where the price is, and nothing about how it got
 * there. This is the smallest thing that answers that.
 *
 * The axis is the DATA, edge to edge. Stretching a handful of samples across a
 * whole window draws a line that claims to describe time it never observed, and
 * pinning them to the left leaves a stub floating in empty glass. Both lie; the
 * clock labels underneath say which stretch of time is actually on screen.
 */
export function Trail({ state }: { state: MarketState }) {
  const { points, loading } = useMarketTrail(state);

  const geom = useMemo(() => {
    const first = points[0];
    const last = points[points.length - 1];
    if (!first || !last || points.length < 2) return null;
    const t0 = first.t;
    const t1 = last.t;
    const span = Math.max(1, t1 - t0);

    // The strike belongs inside the frame whatever the price did: it is the line
    // the whole question turns on, and a trail that runs off above it tells you
    // nothing about the distance you are betting on.
    const values = [...points.map((p) => p.price), state.strike].filter((v) => v > 0);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const pad = (hi - lo) * 0.12 || Math.max(hi * 0.0005, 1);
    const top = hi + pad;
    const bottom = lo - pad;

    const x = (t: number) => PAD + ((t - t0) / span) * (W - PAD * 2);
    const y = (v: number) => PAD + ((top - v) / (top - bottom)) * (H - PAD * 2);

    const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.price).toFixed(1)}`).join('');
    return {
      d,
      area: `${d}L${x(t1).toFixed(1)} ${H}L${x(t0).toFixed(1)} ${H}Z`,
      strikeY: y(state.strike),
      lastX: x(last.t),
      lastY: y(last.price),
      last: last.price,
      from: state.openTime + t0,
      to: state.openTime + t1,
    };
  }, [points, state.strike, state.openTime]);

  if (loading) {
    return (
      <div className="trail trail--empty">
        <div className="panel-loading"><i /><i /><i /><span>reading the tape</span></div>
      </div>
    );
  }
  if (!geom) {
    return (
      <div className="trail trail--empty">
        <span>no price history for this window yet</span>
      </div>
    );
  }

  const up = geom.last >= state.strike;
  const tone = up ? 'up' : 'dn';

  return (
    <div className={`trail trail--${tone}`}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
           aria-label={`${state.symbol} price against a strike of ${price(state.strike)}`}>
        <defs>
          <linearGradient id={`trailfill-${tone}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={up ? '#3FD98B' : '#FF5A48'} stopOpacity="0.28" />
            <stop offset="100%" stopColor={up ? '#3FD98B' : '#FF5A48'} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={geom.area} fill={`url(#trailfill-${tone})`} />
        <line x1="0" x2={W} y1={geom.strikeY} y2={geom.strikeY}
              className="trail__strike" strokeDasharray="3 4" />
        <path d={geom.d} className="trail__line" fill="none" />
        <circle cx={geom.lastX} cy={geom.lastY} r="3" className="trail__now" />
      </svg>
      <div className="trail__axis">
        <span>{clock(geom.from)}</span>
        <span className="trail__strikelab">strike {price(state.strike)}</span>
        <span>{clock(geom.to)}</span>
      </div>
    </div>
  );
}

function clock(sec: number): string {
  const d = new Date(sec * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
