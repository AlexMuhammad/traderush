import type { Engine } from '../engine/engine';
import { money } from '../engine/market';
import type { ConsoleSnapshot } from '../engine/types';
import { Key } from './Key';

const STAKES = [
  { pct: 25, label: '25%' },
  { pct: 50, label: '50%' },
  { pct: 75, label: '75%' },
  { pct: 100, label: 'Max' },
];

/** How much to stake, as a share of the balance. Shown only while you have no
 *  position — once you are in, the ticket takes this slot. */
export function OrderPad({ engine, s }: { engine: Engine; s: ConsoleSnapshot }) {
  return (
    <div className="order">
      <div className="amt">
        {STAKES.map(({ pct, label }) => (
          <Key
            key={pct}
            lit={s.stakePct === pct}
            onGesture={() => engine.wake()}
            onPress={() => engine.setStakePct(pct)}
          >
            {label}
          </Key>
        ))}
      </div>
      <div className="calc">
        <span>{s.costNote}</span>
        <span>{money(s.cost)} USDso</span>
      </div>
    </div>
  );
}
