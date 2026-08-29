import type { Engine } from '../engine/engine';
import type { ConsoleSnapshot } from '../engine/types';

/** Two rockers: which asset, which window. The labels come from whatever is
 *  actually live — the venue runs 1H/4H/24H, not the fixed 15M/1H the prototype
 *  assumed, and a dial that lies about its own interval is worse than no dial. */
export function Tuner({ engine, s }: { engine: Engine; s: ConsoleSnapshot }) {
  const assetIdx = s.raceIndex >= 2 ? 1 : 0;
  const intervalIdx = s.raceIndex % 2;

  const assets = [s.slots[0]?.asset ?? 'BTC', s.slots[2]?.asset ?? 'ETH'];
  // Intervals belong to the selected asset's pair.
  const base = assetIdx * 2;
  const intervals = [s.slots[base]?.interval ?? '—', s.slots[base + 1]?.interval ?? '—'];

  return (
    <div className="tuner">
      <div className="seg">
        {assets.map((label, i) => (
          <button
            key={`${label}-${i}`}
            className={assetIdx === i ? 'on' : undefined}
            onPointerDown={() => { engine.wake(); engine.tuneAsset(i as 0 | 1); }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="seg">
        {intervals.map((label, i) => (
          <button
            key={`${label}-${i}`}
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
