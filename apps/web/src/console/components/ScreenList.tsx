import { useEffect, useRef, type ReactNode } from 'react';

/** A row on the screen. `sub` is the dim second line. */
export interface ScreenItem {
  key: string;
  label: string;
  right?: ReactNode;
  meta?: ReactNode;
  sub?: ReactNode;
  disabled?: boolean;
  /** Marked with a bar: the dial you are already on, or the current screen. */
  current?: boolean;
}

/**
 * Everything the CRT shows is one of these — the menu, the market list, your
 * duels. One component because they are the same object: a cursor moving down
 * a list of rows, driven either by the pad or by a finger.
 */
export function ScreenList({
  title, right, items, cursor, onCursor, onSelect, empty, bindSelect,
}: {
  title: string;
  right?: ReactNode;
  items: ScreenItem[];
  cursor: number;
  onCursor: (i: number) => void;
  onSelect: (item: ScreenItem) => void;
  empty?: ReactNode;
  /** Hands the pad's SELECT the same action a click would fire. */
  bindSelect?: (fire: () => void) => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  // The pad can walk past the end of a list that shrank under it.
  const at = items.length ? Math.min(cursor, items.length - 1) : 0;

  bindSelect?.(() => {
    const item = items[at];
    if (item && !item.disabled) onSelect(item);
  });

  // Keep the cursor on screen when the pad walks past the fold.
  useEffect(() => {
    const el = bodyRef.current?.querySelector<HTMLElement>('[data-cursor="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [at, items.length]);

  return (
    <div className="screen">
      <div className="screen__bar">
        <span>{title}</span>
        {right ? <em>{right}</em> : null}
      </div>

      <div className="screen__body" ref={bodyRef}>
        {!items.length && <div className="screen__empty">{empty ?? 'nothing here'}</div>}
        {items.map((item, i) => (
          <button
            key={item.key}
            data-cursor={i === at}
            className={[
              'scanrow',
              i === at && 'at',
              item.current && 'tuned',
              item.disabled && 'off',
            ].filter(Boolean).join(' ')}
            onPointerEnter={() => onCursor(i)}
            onClick={() => !item.disabled && onSelect(item)}
          >
            <span className="name">
              <i className="caret">{i === at ? '▸' : ' '}</i>{item.label}
            </span>
            <span className="odds">{item.right}</span>
            <span className="left">{item.meta}</span>
            {item.sub ? <span className="sub">{item.sub}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}
