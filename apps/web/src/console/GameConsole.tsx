import { useEffect, useMemo, useState } from 'react';
import { Engine } from './engine/engine';
import type { ConsoleSnapshot } from './engine/types';
import { Panel } from './components/Panel';
import { Marquee } from './components/Marquee';
import { Window } from './components/Window';
import { Tuner } from './components/Tuner';
import { OrderPad } from './components/OrderPad';
import { Ticket } from './components/Ticket';
import { CallKeys } from './components/CallKeys';
import { Footer } from './components/Footer';
import { NavMenu } from './components/NavMenu';
import './console.css';

/**
 * THE RUN — the console.
 *
 * Two halves that do not overlap:
 *
 *   `engine/`   owns all state and paints the canvas, at animation-frame and
 *               interval rates. React is not involved.
 *   this tree   renders the chrome from a `ConsoleSnapshot` the engine
 *               publishes whenever something a human would notice changes.
 *
 * The only way the chrome affects the world is by calling an engine action
 * (`board`, `bail`, `tune`, `setStakePct`, `cycleSpeed`), so there is exactly
 * one source of truth and no state to keep in step.
 *
 * The market is simulated — see `engine/market.ts`. Swapping in real data means
 * replacing that one module; nothing in `components/` reads it directly.
 */
export function GameConsole({ navigate }: { navigate: (to: string) => void }) {
  const engine = useMemo(() => new Engine(), []);
  const [snap, setSnap] = useState<ConsoleSnapshot | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // A callback ref, not useRef: the drawer needs to re-render once the mount
  // node exists, and a ref mutation does not trigger that.
  const [mount, setMount] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    const unsubscribe = engine.subscribe(setSnap);
    engine.start();
    return () => { unsubscribe(); engine.stop(); };
  }, [engine]);

  if (!snap) return null;

  return (
    <div className="console-stage">
      <Panel hot={snap.hot} mountRef={setMount}>
        <Marquee
          asset={snap.asset}
          interval={snap.interval}
          riders={snap.riders}
          expiryLabel={snap.expiryLabel}
          strike={snap.strike}
          onOpenMenu={() => { engine.wake(); setMenuOpen(true); }}
        />

        <Window engine={engine} s={snap} />
        <Tuner engine={engine} s={snap} />

        {/* One slot, two states: stake it, or watch it. */}
        {snap.pos ? <Ticket engine={engine} s={snap} /> : <OrderPad engine={engine} s={snap} />}

        <CallKeys engine={engine} s={snap} />
        <Footer engine={engine} s={snap} />

        <NavMenu
          open={menuOpen}
          onOpenChange={setMenuOpen}
          container={mount}
          onNavigate={navigate}
        />
      </Panel>

      <p className="console-hint">
        Banteng menguasai wilayah atas, beruang wilayah bawah.
        Mereka tidak bisa menyeberang — kamu yang masuk.
      </p>
    </div>
  );
}
