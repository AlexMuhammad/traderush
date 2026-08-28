import type { Engine } from '../engine/engine';
import type { ConsoleSnapshot } from '../engine/types';

/** Two rocker segments: which asset, which window length. Four races in total.
 *  These are the only controls that switch what the canvas is showing. */
export function Tuner({ engine, s }: { engine: Engine; s: ConsoleSnapshot }) {
  const assetIdx = s.raceIndex >= 2 ? 1 : 0;
  const intervalIdx = s.raceIndex % 2;

  return (
    <div className="tuner">
      <div className="seg">
        {(['BTC', 'ETH'] as const).map((label, i) => (
          <button
            key={label}
            className={assetIdx === i ? 'on' : undefined}
            onPointerDown={() => { engine.wake(); engine.tuneAsset(i as 0 | 1); }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="seg">
        {(['15M', '1H'] as const).map((label, i) => (
          <button
            key={label}
            className={intervalIdx === i ? 'on' : undefined}
            onPointerDown={() => { engine.wake(); engine.tuneInterval(i as 0 | 1); }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
