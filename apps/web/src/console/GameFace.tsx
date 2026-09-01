import type { ReactNode } from 'react';
import type { Engine } from './engine/engine';
import type { ConsoleSnapshot } from './engine/types';
import { Window } from './components/Window';
import { Tuner } from './components/Tuner';
import { CallKeys } from './components/CallKeys';
import { AmountPad } from './components/AmountPad';
import { useTakeSide } from './room/useTakeSide';
import { useHeldSide } from './useHeldSide';

/**
 * TRADE RUSH — the instrument face.
 *
 * The dials and keys only. There is no paper position here any more: the keys
 * open a room, so the only money on this machine is the collateral. The plate,
 * the header, the footer and the menu are
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
  const marketId = engine.currentMarketId || undefined;
  const take = useTakeSide(marketId, useHeldSide(marketId));

  return (
    <>
      <Window engine={engine} s={s} screen={screen} />
      <Tuner engine={engine} s={s} />

      {/* Amount first: it decides whether either key can be pressed and what
          each would return. Then the key, which is the write. */}
      <AmountPad take={take} />

      <CallKeys
        engine={engine} s={s}
        disabled={!take.ready} pending={take.pending}
        onTake={(side) => { engine.wake(); void take.take(side); }}
      />
    </>
  );
}
