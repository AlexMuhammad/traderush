import { useEffect, useRef, type ReactNode } from 'react';
import type { Engine } from '../engine/engine';
import { PROGRESS_SEGMENTS } from '../engine/engine';
import type { ConsoleSnapshot } from '../engine/types';

/** The CRT and the instruments under it.
 *
 *  The canvas is handed to the engine once and never touched by React again —
 *  re-rendering this component does not re-render the scene. Everything below
 *  the glass is ordinary React driven by the snapshot.
 */
export function Window({
  engine, s, screen,
}: {
  engine: Engine;
  s: ConsoleSnapshot;
  /** Shown ON the CRT, over the canvas and under the scanlines. */
  screen?: ReactNode;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (ref.current) engine.attachCanvas(ref.current);
  }, [engine]);

  const lit = Math.round(s.progress * PROGRESS_SEGMENTS);
  const trend = s.bullish ? 'up' : 'dn';

  return (
    <div className="window">
      <div className="crt">
        {/* The canvas stays mounted under any screen: coming back to the game is
            instant, and the engine skips painting a detached canvas anyway. */}
        <canvas ref={ref} />
        {screen}
        <div className="scan" />
      </div>

      <div className="readout">
        <span className={`px ${trend}`}>{s.spot.toFixed(0)}</span>
        <span className={`dl ${trend}`}>{s.delta >= 0 ? '+' : ''}{s.delta.toFixed(1)}</span>
        <span>{s.ground}</span>
      </div>

      {/* Fixed segment count, so a 15m and a 1h window fill at the same rate. */}
      <div className={`travelbar${s.urgent ? ' urg' : ''}`}>
        {Array.from({ length: PROGRESS_SEGMENTS }, (_, i) => (
          <i key={i} className={i < lit ? 'on' : undefined} />
        ))}
      </div>

      <div className="state">
        <span>{s.statusText}</span>
        <span>{s.clock}</span>
      </div>
    </div>
  );
}
