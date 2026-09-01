import { useEffect, useState, useRef } from 'react';
import type { MarketState } from '@traderush/sdk';
import { useEngine } from '../engineContext';
import { Trail } from './Trail';

/**
 * The window a match is being fought on — the same glass the game face shows.
 *
 * A duel and a room ARE the run: the same market, the same line, the same two
 * animals. Showing them a still chart while the game face got a scene said they
 * were a different, lesser thing. The engine is handed this canvas and tuned to
 * the match's market, and told which side is held so the right animal hunts.
 *
 * The canvas is only borrowed. The game face re-attaches its own on the way
 * back, and the engine draws into whichever it was given last.
 */
export function MatchScreen({
  state, side, econ,
}: {
  state: MarketState;
  /** The side held here, or null while nobody has taken one. */
  side: 'up' | 'down' | null;
  /** What that side is worth, when this screen knows. Feeds the settlement
   *  count-up with real money instead of leaving it dark. */
  econ?: { stake: number; payoutIfWon: number } | null;
}) {
  const engine = useEngine();
  const ref = useRef<HTMLCanvasElement>(null);
  // Null while unknown. Tuning publishes a snapshot, so it has to happen in an
  // effect — done during render it sets state on the console while the console
  // is still rendering this.
  const [tuned, setTuned] = useState<boolean | null>(null);

  useEffect(() => {
    if (!engine) { setTuned(false); return; }
    // The engine cannot draw a window it is not watching, and drawing a
    // DIFFERENT market's scene under this room's numbers would be worse than
    // drawing none.
    setTuned(engine.tuneToMarket(state.marketId));
  }, [engine, state.marketId]);

  useEffect(() => {
    if (!engine || tuned !== true || !ref.current) return;
    engine.attachCanvas(ref.current);
    engine.wake();
  }, [engine, tuned]);

  useEffect(() => {
    if (!engine || tuned !== true) return;
    engine.setWatchSide(side, econ ?? null);
    return () => engine.setWatchSide(null);
    // The market id is a dependency because a roll clears the engine's held
    // side; a screen that is still showing a real position has to say so again.
  }, [engine, tuned, side, state.marketId, econ?.stake, econ?.payoutIfWon]);

  // Until it is on a dial — and for a market that never will be — the trail is
  // the honest picture: the same window, drawn from the same tape.
  if (tuned !== true) return <Trail state={state} />;

  return (
    <>
      <canvas ref={ref} />
      <div className="scan" />
    </>
  );
}
