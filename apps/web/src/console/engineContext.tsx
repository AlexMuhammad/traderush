import { createContext, useContext, type ReactNode } from 'react';
import type { Engine } from './engine/engine';

/** The running machine, reachable from any screen.
 *
 *  The game face used to be the only thing that could show the scene, because it
 *  was the only thing holding the engine. A duel and a room are the same window
 *  being watched by two people who have money on it — they should get the same
 *  glass, not a still picture of it. */
const EngineCtx = createContext<Engine | null>(null);

export function EngineProvider({ engine, children }: { engine: Engine; children: ReactNode }) {
  return <EngineCtx.Provider value={engine}>{children}</EngineCtx.Provider>;
}

export function useEngine(): Engine | null {
  return useContext(EngineCtx);
}
