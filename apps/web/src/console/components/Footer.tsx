import type { Engine } from '../engine/engine';
import { money } from '../engine/market';
import type { ConsoleSnapshot } from '../engine/types';
import { useSdk } from '../../sdk';

/** What you are looking at, and what you have.
 *
 *  The speed control is DEMO ONLY. Live, `t` is wall-clock against the market's
 *  own window — the chain does not care how fast we are watching — so offering
 *  "×20" beside "live prices" would be a straight contradiction.
 *
 *  The points are paper either way: the console's keys place no real orders.
 */
export function Footer({ engine, s }: { engine: Engine; s: ConsoleSnapshot }) {
  const { cfg } = useSdk();

  return (
    <div className="foot eng">
      {s.live ? (
        <span>Live · {cfg.network} · chain {cfg.chainId}</span>
      ) : (
        <span style={{ cursor: 'pointer' }} onPointerDown={() => { engine.wake(); engine.cycleSpeed(); }}>
          Demo ×{s.speed} · {s.speed === 1 ? 'real time' : 'tap to slow'}
        </span>
      )}
      <span>{money(s.balance)} pts</span>
    </div>
  );
}
