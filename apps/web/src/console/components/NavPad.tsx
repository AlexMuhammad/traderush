/** The direction pad.
 *
 *  Appears only while the screen is showing a list — on the game face the call
 *  keys are the controls and a second cluster would just crowd the plate. */
export function NavPad({
  onUp, onDown, onSelect, onBack, selectLabel = 'select',
}: {
  onUp: () => void;
  onDown: () => void;
  onSelect: () => void;
  onBack: () => void;
  selectLabel?: string;
}) {
  return (
    <div className="navpad">
      <button className="navpad__key navpad__key--dir" onClick={onUp} aria-label="up">▲</button>
      <button className="navpad__key navpad__key--dir" onClick={onDown} aria-label="down">▼</button>
      <button className="navpad__key navpad__key--go" onClick={onSelect}>{selectLabel}</button>
      <button className="navpad__key" onClick={onBack}>back</button>
    </div>
  );
}
