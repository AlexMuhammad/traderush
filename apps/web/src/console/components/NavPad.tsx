/**
 * The direction cluster — one merged strip, icons only, always present.
 *
 *  Always present because a control that appears and disappears is not a
 *  control on a machine, it is a web page. So the arrows have to mean something
 *  on every screen: on a list they move the cursor, on the game face they step
 *  through the dials.
 *
 *  `back` is the one key that genuinely has nothing to do on the game face. It
 *  dims rather than vanishing, the way a key on real hardware would.
 */
export function NavPad({
  onUp, onDown, onSelect, onBack, canBack,
}: {
  onUp: () => void;
  onDown: () => void;
  onSelect: () => void;
  onBack: () => void;
  canBack: boolean;
}) {
  return (
    <div className="navpad">
      <button className="navpad__key" onClick={onUp} aria-label="up">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 4l5 7H3z" /></svg>
      </button>
      <button className="navpad__key" onClick={onDown} aria-label="down">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 12L3 5h10z" /></svg>
      </button>
      <button className="navpad__key navpad__key--go" onClick={onSelect} aria-label="select">
        <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="4" /></svg>
      </button>
      <button className="navpad__key" onClick={onBack} disabled={!canBack} aria-label="back">
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M13 8H4M7 4L3 8l4 4" fill="none" strokeWidth="1.8"
                strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
