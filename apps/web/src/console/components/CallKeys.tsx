import type { Engine } from '../engine/engine';
import type { ConsoleSnapshot } from '../engine/types';
import { Key } from './Key';
import { SideIcon } from './SideIcon';

/** The two calls. The bull holds the ground above the strike, the bear below it.
 *
 *  These used to stake paper money the console settled for itself, which meant
 *  the machine had two currencies — points here, tUSDC everywhere else — and a
 *  win on this screen moved neither. Pressing one now opens a room on the window
 *  you are watching, with that side already taken. One currency, one way in.
 *
 *  Each key shows the book's implied probability and the multiple it would pay.
 *  When a side has no liquidity the key says so rather than silently failing.
 */
export function CallKeys({
  engine, s, onTake, disabled, pending,
}: {
  engine: Engine;
  s: ConsoleSnapshot;
  /** Back this side. This is the write — see useTakeSide. */
  onTake: (side: 'up' | 'down') => void;
  /** No amount, no balance, nothing to join: the press cannot go anywhere. */
  disabled: boolean;
  /** The side currently in flight, if any. */
  pending: 'up' | 'down' | null;
}) {
  const upPct = Math.round(s.upP * 100);
  // The horn locks them, and so does anything the pad above is complaining
  // about: a key that cannot go anywhere should not invite the press.
  const locked = s.phase !== 'trade' || disabled;

  const sides = [
    { side: 'up' as const, name: 'UP', pct: upPct, mult: 1 / s.upP, dry: s.dryUp },
    { side: 'down' as const, name: 'DOWN', pct: 100 - upPct, mult: 1 / (1 - s.upP), dry: s.dryDown },
  ];

  return (
    <div className="calls">
      {sides.map((k) => (
        <Key
          key={k.side}
          lit={s.watchSide === k.side}
          dry={k.dry}
          disabled={locked}
          onGesture={(accepted) => {
            engine.wake();
            if (!accepted) { engine.audio.reject(); engine.shake = 3; }
          }}
          onPress={() => onTake(k.side)}
        >
          <SideIcon side={k.side} />
          <span className="nm">{k.name}</span>
          <span className="pct">{k.pct}%</span>
          <span className="mul">
            {pending === k.side ? 'placing…' : k.dry ? 'no liquidity' : `×${k.mult.toFixed(1)}`}
          </span>
        </Key>
      ))}
    </div>
  );
}
