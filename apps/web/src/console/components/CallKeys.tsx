import type { Engine } from '../engine/engine';
import type { ConsoleSnapshot } from '../engine/types';
import { Key } from './Key';

/** The two calls. The bull holds the ground above the strike, the bear below it.
 *
 *  Each key shows the implied probability and the multiple it pays. When a side
 *  has no liquidity the key goes dead and says so rather than silently failing.
 */
export function CallKeys({ engine, s }: { engine: Engine; s: ConsoleSnapshot }) {
  const upPct = Math.round(s.upP * 100);
  // Only the horn locks the keys. Holding a position is already refused by
  // board(), and leaving the key live lets the lit one still respond.
  const locked = s.phase !== 'trade';

  const sides = [
    {
      side: 'up' as const, beast: '🐂', name: 'UP',
      pct: upPct, mult: 1 / s.upP, dry: s.dryUp,
    },
    {
      side: 'down' as const, beast: '🐻', name: 'DOWN',
      pct: 100 - upPct, mult: 1 / (1 - s.upP), dry: s.dryDown,
    },
  ];

  return (
    <div className="calls">
      {sides.map((k) => (
        <Key
          key={k.side}
          lit={s.pos?.side === k.side}
          dry={k.dry}
          disabled={locked}
          onGesture={(accepted) => {
            engine.wake();
            if (!accepted) { engine.audio.reject(); engine.shake = 3; }
          }}
          onPress={() => engine.board(k.side)}
        >
          <span className="beast">{k.beast}</span>
          <span className="nm">{k.name}</span>
          <span className="pct">{k.pct}%</span>
          <span className="mul">{k.dry ? 'no liquidity' : `×${k.mult.toFixed(1)}`}</span>
        </Key>
      ))}
    </div>
  );
}
