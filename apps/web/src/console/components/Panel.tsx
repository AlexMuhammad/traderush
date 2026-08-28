import type { ReactNode, Ref } from 'react';

/** The steel plate everything is mounted on. Four screws, and a `hot` state
 *  that makes the whole panel glow when the window is nearly up or you are
 *  being hunted.
 *
 *  `panelRef` hands the node out so the nav drawer can portal into it — that is
 *  what makes the drawer rise from the console instead of from the viewport. */
export function Panel({
  hot, menuOpen, panelRef, children,
}: {
  hot: boolean;
  /** Clips the plate while the drawer slides; see console.css. */
  menuOpen?: boolean;
  panelRef?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  const classes = ['panel', hot && 'hot', menuOpen && 'menu-open'].filter(Boolean).join(' ');
  return (
    <div className={classes} ref={panelRef}>
      <span className="screw" style={{ top: 7, left: 7 }} />
      <span className="screw" style={{ top: 7, right: 7 }} />
      <span className="screw" style={{ bottom: 7, left: 7 }} />
      <span className="screw" style={{ bottom: 7, right: 7 }} />
      {children}
    </div>
  );
}
