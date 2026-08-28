/** The panel's menu key: three engraved bars in a small well, top right.
 *
 *  Not built on `Key` — that one is a chunky control with a 3px skirt sized for
 *  a thumb. This is a flush panel fitting, so it gets its own shallow well.
 */
export function MenuKey({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      className="menu-key"
      aria-label="Open menu"
      onPointerDown={onOpen}
    >
      <span className="menu-key__housing" />
      <span className="menu-key__cap">
        <i /><i /><i />
      </span>
    </button>
  );
}
