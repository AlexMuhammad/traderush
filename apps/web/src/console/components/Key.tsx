import { useState, type ReactNode } from 'react';

/** A physical key: a well cut into the panel, and a cap that sits in it.
 *
 *  Only the cap moves. The `down` class is held while a pointer is on the key
 *  and released on up/cancel/leave, so dragging off a key un-presses it the way
 *  a real one would. `dry` keys refuse the press and buzz instead.
 *
 *  Every button on the console is this component; the size and radius come from
 *  the class the parent puts on it (`.amt .key`, `.exit`, `.calls .key`).
 */
export interface KeyProps {
  children: ReactNode;
  onPress?: () => void;
  /** Lamp on. */
  lit?: boolean;
  /** No liquidity on this side — press is rejected. */
  dry?: boolean;
  disabled?: boolean;
  className?: string;
  /** Fires on any press, including a rejected one, so the console can start
   *  its AudioContext from a real gesture. */
  onGesture?: (accepted: boolean) => void;
  title?: string;
}

export function Key({
  children, onPress, lit, dry, disabled, className = '', onGesture, title,
}: KeyProps) {
  const [down, setDown] = useState(false);

  const press = () => {
    if (disabled) return;
    if (dry) { onGesture?.(false); return; }
    onGesture?.(true);
    setDown(true);
  };

  const release = () => {
    if (!down) return;
    setDown(false);
    onPress?.();
  };

  const classes = ['key', className, lit && 'lit', dry && 'dry', down && 'down']
    .filter(Boolean).join(' ');

  return (
    <button
      type="button"
      className={classes}
      disabled={disabled}
      title={title}
      onPointerDown={press}
      onPointerUp={release}
      onPointerCancel={() => setDown(false)}
      onPointerLeave={() => setDown(false)}
    >
      <span className="housing" />
      <span className="cap">{children}</span>
    </button>
  );
}
