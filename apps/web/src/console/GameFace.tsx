import type { ReactNode } from 'react';
import type { Engine } from './engine/engine';
import type { ConsoleSnapshot } from './engine/types';
import { Window } from './components/Window';
import { Tuner } from './components/Tuner';
import { OrderPad } from './components/OrderPad';
import { Ticket } from './components/Ticket';
import { CallKeys } from './components/CallKeys';

/**
 * THE RUN — the instrument face.
 *
 * The dials and keys only. The plate, the header, the footer and the menu are
 * the console SHELL and live in ConsoleApp, because the duel screens hang off
 * the same shell — one machine that shows different things, not two front ends.
 *
 * The canvas is handed to the engine once and never touched by React again.
 * The market behind it is simulated (engine/market.ts); the duel screens are
 * not, and closing that gap is the last real inconsistency here.
 */
export function GameFace({
  engine, s, screen,
}: {
  engine: Engine;
  s: ConsoleSnapshot;
  /** Optional content shown on the glass instead of the game. */
  screen?: ReactNode;
}) {
  return (
    <>
      <Window engine={engine} s={s} screen={screen} />
      <Tuner engine={engine} s={s} />

      {/* One slot, two states: stake it, or watch it. */}
      {s.pos ? <Ticket engine={engine} s={s} /> : <OrderPad engine={engine} s={s} />}

      <CallKeys engine={engine} s={s} />
    </>
  );
}
