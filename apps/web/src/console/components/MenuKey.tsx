/** The panel's menu key: three engraved bars in a small well, top right.
 *
 *  Not built on `Key` — that one is a chunky control with a 3px skirt sized for
 *  a thumb. This is a flush panel fitting, so it gets its own shallow well.
 */
export function MenuKey({ onOpen, open = false }: { onOpen: () => void; open?: boolean }) {
  return (
    <button
      type="button"
      className="menu-key"
      aria-label={open ? 'Close menu' : 'Open menu'}
      aria-expanded={open}
      onPointerDown={onOpen}
    >
      <span className="menu-key__housing" />
      <span className="menu-key__cap">
        <i /><i /><i />
      </span>
    </button>
  );
}
