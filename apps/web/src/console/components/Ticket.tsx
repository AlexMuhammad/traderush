import type { Engine } from '../engine/engine';
import { money } from '../engine/market';
import type { ConsoleSnapshot } from '../engine/types';
import { Key } from './Key';
import { SideIcon } from './SideIcon';

/**
 * Your open position.
 *
 * Three things and no more: which side, what it is worth now, and what you can
 * do about it. The stake and the payout sit on one line in plain words — the
 * old "1424 sh @ 50%" made a reader decode jargon to learn what the next line
 * already said.
 *
 * The exit key only appears while there is an exit. A settled position showed a
 * full-size PAID button that could not be pressed, which is a control lying
 * about being a control.
 */
export function Ticket({ engine, s }: { engine: Engine; s: ConsoleSnapshot }) {
  if (!s.pos) return null;
  const winning = s.pnl >= 0;

  return (
    <div className="ticket">
      <div className="tline">
        <span className="tside">
          <SideIcon side={s.pos.side} />
          {s.ticketSide}
          <em>{s.ticketOdds}%</em>
        </span>
        <span className={`pnl ${winning ? 'up' : 'dn'}`}>
          {winning ? '+' : '−'}{money(Math.abs(s.pnl))}
        </span>
      </div>

      <div className="tsub">{s.ticketNote}</div>

      {s.canBail ? (
        <Key className="exit" onGesture={() => engine.wake()} onPress={() => engine.bail()}>
          {s.bailLabel}
        </Key>
      ) : (
        // Settled: state the outcome, do not offer a key that does nothing.
        <div className={`tdone ${winning ? 'up' : 'dn'}`}>{s.bailLabel}</div>
      )}
    </div>
  );
}
