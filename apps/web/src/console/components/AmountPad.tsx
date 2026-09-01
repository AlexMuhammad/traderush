import type { useTakeSide } from '../room/useTakeSide';
import { Fault } from './Readout';

/**
 * How much, and what it would come back as.
 *
 * It sits above the side keys because it is the first decision: until there is
 * an amount, neither side can say what it returns and neither key can be
 * pressed. The keys do the committing — see CallKeys and useTakeSide.
 */
export function AmountPad({ take }: { take: ReturnType<typeof useTakeSide> }) {
  const up = take.returns('up');
  const down = take.returns('down');

  return (
    <div className="order">
      <label className="field field--inline">
        <span>amount ({take.symbol})</span>
        <input
          value={take.amountStr}
          onChange={(e) => take.setAmountStr(e.target.value)}
          inputMode="decimal"
        />
      </label>

      {take.blocker ? (
        <div className="calc calc--bad">
          <span>{take.blocker.startsWith('insufficient') ? 'balance' : 'blocked'}</span>
          <span>{take.blocker}</span>
        </div>
      ) : (
        // What each side returns if it wins, at the book as it stands. Both, so
        // the choice is made against numbers rather than against a colour — and
        // a side with nothing offered says so instead of quoting a price nobody
        // is holding.
        <div className="calc">
          <span>returns</span>
          <span>
            <em className="up">{take.liquid('up') && up !== null ? take.format(up) : 'no offer'}</em>
            {' up · '}
            <em className="dn">{take.liquid('down') && down !== null ? take.format(down) : 'no offer'}</em>
            {' down'}
          </span>
        </div>
      )}

      {take.error ? <Fault error={take.error} /> : null}
    </div>
  );
}
