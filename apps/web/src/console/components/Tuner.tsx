import { useRef } from 'react';
import type { Engine } from '../engine/engine';
import type { ConsoleSnapshot } from '../engine/types';

/**
 * Asset as buttons, window length as a wheel.
 *
 * The venue runs five intervals per asset — 1m, 5m, 1h, 4h, 24h — and a fixed
 * pair of buttons could only ever reach two of them. A wheel takes as many as
 * exist and stays the same size, so adding a window to the venue does not
 * change the shape of the plate.
 *
 * Drag it, wheel it, or tap the dimmed neighbour above or below.
 */
export function Tuner({ engine, s }: { engine: Engine; s: ConsoleSnapshot }) {
  const drag = useRef<{ y: number; moved: boolean } | null>(null);

  const step = (delta: 1 | -1) => { engine.wake(); engine.stepInterval(delta); };

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { y: e.clientY, moved: false };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.y;
    // One notch per 22px. Enough travel that a shaky tap does not change the
    // market out from under someone.
    if (Math.abs(dy) < 22) return;
    step(dy > 0 ? -1 : 1);       // drag DOWN reveals the shorter window above
    drag.current = { y: e.clientY, moved: true };
  };
  const onPointerUp = () => { drag.current = null; };

  // Only the value BELOW is shown, clipped — that one ghost is what says the
  // list continues. A second one above would balance the box and say less.
  const below = s.intervals[s.intervalIndex + 1] ?? s.intervals[0];

  return (
    <div className="tuner">
      <div className="seg">
        {s.assets.map((label, i) => (
          <button
            key={label}
            className={s.assetIndex === i ? 'on' : undefined}
            onPointerDown={() => { engine.wake(); engine.tuneAsset(i); }}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        className="wheel"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={(e) => step(e.deltaY > 0 ? 1 : -1)}
        role="listbox"
        aria-label="window length"
      >
        <div className="wheel__now">{s.intervals[s.intervalIndex] ?? s.interval}</div>
        <div className="wheel__ghost" aria-hidden="true">{below ?? ''}</div>
      </div>
    </div>
  );
}
