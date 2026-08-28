import { Drawer } from 'vaul';
import { loadConfig } from '@bullrun/sdk';

/** The console's way out.
 *
 *  A vaul drawer scoped to the panel via `container`, so it rises from inside
 *  the console rather than from the bottom of the window. vaul sets no inline
 *  `position`, which is what lets console.css pin it to the panel instead of
 *  the viewport.
 */
export function NavMenu({
  open, onOpenChange, container, onNavigate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The panel's clipping layer, so the drawer rises from inside the console. */
  container: HTMLElement | null;
  onNavigate: (to: string) => void;
}) {
  const cfg = loadConfig(import.meta.env as unknown as Record<string, string | undefined>);

  const go = (to: string) => { onOpenChange(false); onNavigate(to); };

  return (
    <Drawer.Root
      open={open}
      onOpenChange={onOpenChange}
      container={container}
      // The drawer lives inside a 384px panel, not the document. Body styles and
      // background scaling would be measured against the viewport and fight it.
      noBodyStyles
      shouldScaleBackground={false}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="drawer-overlay" />
        <Drawer.Content className="drawer" aria-describedby={undefined}>
          <div className="drawer__handle" />
          <Drawer.Title className="drawer__title">The Run</Drawer.Title>

          <nav className="drawer__list">
            <button className="drawer__item" onClick={() => go('/#markets')}>
              <span>Markets</span>
              <em>live event contracts</em>
            </button>

            {/* Honest dead end: there is no duels index screen yet. Better a
                disabled row that says so than a link that goes nowhere. */}
            <button className="drawer__item" disabled>
              <span>My duels</span>
              <em>{cfg.escrowAddress ? 'no duel list screen yet' : `escrow not deployed on ${cfg.network}`}</em>
            </button>

            <button className="drawer__item" onClick={() => go('/#connect')}>
              <span>Connect wallet</span>
              <em>{cfg.network} · chain {cfg.chainId}</em>
            </button>
          </nav>

          <button className="drawer__close" onClick={() => onOpenChange(false)}>Close</button>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
