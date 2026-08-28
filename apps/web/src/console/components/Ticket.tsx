import type { Engine } from '../engine/engine';
import { money } from '../engine/market';
import type { ConsoleSnapshot } from '../engine/types';
import { Key } from './Key';

/** Your open position, marked to market every price tick.
 *
 *  It replaces the order pad rather than sitting beside it: while you are in a
 *  race there is exactly one thing to decide, and that is whether to get out.
 *  After settlement the exit key becomes the receipt.
 */
export function Ticket({ engine, s }: { engine: Engine; s: ConsoleSnapshot }) {
  if (!s.pos) return null;
  const winning = s.pnl >= 0;

  return (
    <div className="ticket">
      <div className="tline">
        <span className="tside">{s.ticketSide}</span>
        <span className={`pnl ${winning ? 'up' : 'dn'}`}>
          {winning ? '+' : '−'}{money(Math.abs(s.pnl))}
        </span>
      </div>
      <div className="tsub">{s.ticketNote}</div>
      <Key
        className="exit"
        disabled={!s.canBail}
        onGesture={() => engine.wake()}
        onPress={() => engine.bail()}
      >
        {s.bailLabel}
      </Key>
    </div>
  );
}
