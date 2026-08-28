import type { Engine } from '../engine/engine';
import { money } from '../engine/market';
import type { ConsoleSnapshot } from '../engine/types';

/** Demo speed on the left, balance on the right. Tapping the speed cycles
 *  20x -> 5x -> real time, so a 15-minute window can be watched end to end. */
export function Footer({ engine, s }: { engine: Engine; s: ConsoleSnapshot }) {
  return (
    <div className="foot eng">
      <span style={{ cursor: 'pointer' }} onPointerDown={() => { engine.wake(); engine.cycleSpeed(); }}>
        Demo ×{s.speed} · {s.speed === 1 ? 'real time' : 'tap to slow'}
      </span>
      <span>{money(s.balance)} USDso</span>
    </div>
  );
}
