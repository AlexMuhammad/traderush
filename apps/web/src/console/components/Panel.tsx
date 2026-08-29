import type { ReactNode, Ref } from 'react';

/** The steel plate everything is mounted on. Four screws, and a `hot` state
 *  that makes the whole panel glow when the window is nearly up or you are
 *  being hunted.
 *
 *  `ref` is here so the wallet sheet can be portalled INTO the plate rather than
 *  over the page. A drawer that covers the browser window is a website's drawer;
 *  this one has to slide up inside the machine. */
export function Panel({
  hot, panelRef, children,
}: {
  hot: boolean;
  panelRef?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  return (
    <div ref={panelRef} className={`panel${hot ? ' hot' : ''}`}>
      <span className="screw" style={{ top: 7, left: 7 }} />
      <span className="screw" style={{ top: 7, right: 7 }} />
      <span className="screw" style={{ bottom: 7, left: 7 }} />
      <span className="screw" style={{ bottom: 7, right: 7 }} />
      {children}
    </div>
  );
}
