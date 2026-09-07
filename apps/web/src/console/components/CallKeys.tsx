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
 *
 *  Whether it CAN pay is a separate question, and the key used to answer it with
 *  the wrong number. `dryUp` is a price threshold — "below 4% implied, call it
 *  dry" — not a reading of the book, so a key could say "no liquidity" about a
 *  side that was quoted merely because it was cheap, and offer a confident
 *  "×10.9" on a side with no resting ask at all. The returns line directly above
 *  it read the pool and said "no offer" at the same moment. One of them was
 *  lying and it was this one.
 *
 *  The book decides now, through the same `useTakeSide` the returns line uses.
 *  Three states, because there are three: not read yet, read and empty, read and
 *  quoted. The multiple is only ever shown for the third.
 */
export function CallKeys({
  engine, s, onTake, disabled, pending, armed, armedLabel, liquid, bookKnown,
}: {
  engine: Engine;
  s: ConsoleSnapshot;
  /** Arm this side, or commit it if it is already armed — see useTakeSide. */
  onTake: (side: 'up' | 'down') => void;
  /** No amount, no balance, nothing to join: the press cannot go anywhere. */
  disabled: boolean;
  /** The side currently in flight, if any. */
  pending: 'up' | 'down' | null;
  /** The side a first press has armed. The second press on it spends. */
  armed: 'up' | 'down' | null;
  /** What that second press would cost, already formatted. */
  armedLabel: string;
  /** Is this side actually being offered? Read from the pool, not from a price. */
  liquid: (side: 'up' | 'down') => boolean;
  /** Has the book been read at all? Until it has, "no offer" would be a guess. */
  bookKnown: boolean;
}) {
  const upPct = Math.round(s.upP * 100);
  // The horn locks them, and so does anything the pad above is complaining
  // about: a key that cannot go anywhere should not invite the press.
  const locked = s.phase !== 'trade' || disabled;

  const sides = [
    { side: 'up' as const, name: 'UP', pct: upPct, mult: 1 / s.upP, dry: bookKnown && !liquid('up') },
    { side: 'down' as const, name: 'DOWN', pct: 100 - upPct, mult: 1 / (1 - s.upP), dry: bookKnown && !liquid('down') },
  ];

  return (
    <div className="calls">
      {sides.map((k) => (
        <Key
          key={k.side}
          className={armed === k.side ? 'armed' : undefined}
          lit={armed === k.side || s.watchSide === k.side}
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
          {/* Armed: the key says what the next press does and what it costs,
              because that press is the one that spends. */}
          <span className="pct">{armed === k.side ? 'CONFIRM' : `${k.pct}%`}</span>
          <span className="mul">
            {pending === k.side ? 'placing…'
              : armed === k.side ? armedLabel
              : !bookKnown ? 'reading…'
              : k.dry ? 'no offer'
              : `×${k.mult.toFixed(1)}`}
          </span>
        </Key>
      ))}
    </div>
  );
}
