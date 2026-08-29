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

      {/* What leaving costs, before you press. The exit price is the bid, the
          ticket's value is the mid, and the gap between them is real money that
          used to be invisible — the key quoted the mid and paid the mid, so
          bailing looked free and taught the wrong thing about a venue whose only
          cost IS the spread. */}
      {s.canBail && s.bailSpread > 0 && (
        <div className="tspread">spread costs {money(s.bailSpread)} to leave</div>
      )}

      {s.canBail ? (
        <Key className="exit" onGesture={() => engine.wake()} onPress={() => engine.bail()}>
          {s.bailLabel}
        </Key>
      ) : (
        // Settled, or nobody bidding: state it, do not offer a key that does
        // nothing. An exit with no counterparty is not a slow exit, it is none.
        <div className={`tdone ${winning ? 'up' : 'dn'}`}>{s.bailLabel}</div>
      )}
    </div>
  );
}
