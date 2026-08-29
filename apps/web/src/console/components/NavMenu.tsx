import { Drawer } from 'vaul';
import { useSdk } from '../../sdk';
import { useWallet } from '../../walletContext';

/** Moving between the console's panels.
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
  const { cfg } = useSdk();
  const { conn, wrongChain, connecting, doConnect, doSwitch } = useWallet();

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
            <button className="drawer__item" onClick={() => go('/')}>
              <span>Play</span>
              <em>the console</em>
            </button>

            <button className="drawer__item" onClick={() => go('/markets')}>
              <span>Markets</span>
              <em>live event contracts</em>
            </button>

            {/* Honest dead end: there is no duels index yet. Better a disabled
                row that says so than a link that goes nowhere. */}
            <button className="drawer__item" disabled>
              <span>My duels</span>
              <em>{cfg.escrowAddress ? 'no index screen yet' : `no escrow on ${cfg.network}`}</em>
            </button>

            {conn && wrongChain ? (
              <button className="drawer__item" onClick={() => { onOpenChange(false); doSwitch(); }}>
                <span>Switch network</span>
                <em>needs {cfg.chainName}</em>
              </button>
            ) : (
              <button
                className="drawer__item"
                disabled={Boolean(conn)}
                onClick={() => { onOpenChange(false); doConnect(); }}
              >
                <span>{conn ? 'Connected' : 'Connect wallet'}</span>
                <em>
                  {conn
                    ? `${conn.account.address.slice(0, 6)}…${conn.account.address.slice(-4)}`
                    : connecting ? 'connecting…' : `${cfg.network} · chain ${cfg.chainId}`}
                </em>
              </button>
            )}
          </nav>

          <button className="drawer__close" onClick={() => onOpenChange(false)}>Close</button>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
