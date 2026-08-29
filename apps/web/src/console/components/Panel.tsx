import type { ReactNode } from 'react';

/** The steel plate everything is mounted on. Four screws, and a `hot` state
 *  that makes the whole panel glow when the window is nearly up or you are
 *  being hunted. */
export function Panel({ hot, children }: { hot: boolean; children: ReactNode }) {
  return (
    <div className={`panel${hot ? ' hot' : ''}`}>
      <span className="screw" style={{ top: 7, left: 7 }} />
      <span className="screw" style={{ top: 7, right: 7 }} />
      <span className="screw" style={{ bottom: 7, left: 7 }} />
      <span className="screw" style={{ bottom: 7, right: 7 }} />
      {children}
    </div>
  );
}
