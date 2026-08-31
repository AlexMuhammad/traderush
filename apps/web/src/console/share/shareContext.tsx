import { createContext, useContext, type ReactNode } from 'react';
import type { WinCard } from './winCard';

/** Somewhere for any screen to hand up a result worth showing off. The sheet
 *  itself lives on the plate, because that is where every sheet lives. */
const ShareCtx = createContext<((card: WinCard) => void) | null>(null);

export function ShareProvider({ onShare, children }: { onShare: (card: WinCard) => void; children: ReactNode }) {
  return <ShareCtx.Provider value={onShare}>{children}</ShareCtx.Provider>;
}

export function useShare(): ((card: WinCard) => void) | null {
  return useContext(ShareCtx);
}
