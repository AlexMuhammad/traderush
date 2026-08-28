import type { ReactNode, Ref } from 'react';

/** The steel plate everything is mounted on. Four screws, and a `hot` state
 *  that makes the whole panel glow when the window is nearly up or you are
 *  being hunted.
 *
 *  The last child is an always-clipping layer the nav drawer is portalled into.
 *  It exists so the drawer can slide past the bottom edge without being seen,
 *  WITHOUT putting `overflow: hidden` on the plate itself — that would cut the
 *  30px lamp glow off the call keys. Because it clips permanently, nothing has
 *  to be timed against the drawer's animation.
 */
export function Panel({
  hot, mountRef, children,
}: {
  hot: boolean;
  /** Receives the drawer's clipping layer; pass it to NavMenu as `container`. */
  mountRef?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  return (
    <div className={`panel${hot ? ' hot' : ''}`}>
      <span className="screw" style={{ top: 7, left: 7 }} />
      <span className="screw" style={{ top: 7, right: 7 }} />
      <span className="screw" style={{ bottom: 7, left: 7 }} />
      <span className="screw" style={{ bottom: 7, right: 7 }} />
      {children}
      <div className="drawer-mount" ref={mountRef} />
    </div>
  );
}
