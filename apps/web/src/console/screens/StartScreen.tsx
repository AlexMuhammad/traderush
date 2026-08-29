/** The title card. The console keeps running behind it, dimmed and blurred, so
 *  the first thing you see is the machine you are about to use. */
export function StartScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="gate__body">
      <div className="wordmark">BULLRUN</div>

      <h1 className="gate__headline">Stay on the right side.</h1>
      <p className="gate__sub">
        Fifteen minutes and one line. The animals never cross it —
        you are the only thing that can.
      </p>

      <button type="button" className="gate__start" onClick={onStart}>
        Start
      </button>

      <p className="gate__fine">
        A wallet is required — everything here settles on-chain.
        <br />
        <strong>BULLRUN has no token.</strong> Unaudited, testnet only.
      </p>
    </div>
  );
}
