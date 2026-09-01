import type { useTakeSide } from '../room/useTakeSide';
import { Key } from './Key';
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

  // Holding something on this window turns the pad into a position, because
  // there is only one thing left to decide: keep it or sell it back.
  if (take.heldSide && take.held > 0n) {
    return (
      <div className="order">
        <div className="trayrow">
          <div className="calc">
            <span>you hold</span>
            <span className={take.heldSide === 'up' ? 'up' : 'dn'}>
              {take.heldSide.toUpperCase()}
            </span>
          </div>
          <div className="calc">
            <span>pays if it wins</span>
            <span className="lamp">{take.format(take.held)}</span>
          </div>
        </div>

        {/* Not the value of the position — the price the bids are offering for
            it, read from the pool. The spread is what changing your mind costs. */}
        <div className={`calc${take.tradeable ? '' : ' calc--bad'}`}>
          <span>{take.tradeable ? 'sell back at' : 'window closed'}</span>
          <span>
            {!take.tradeable ? 'redeem it under Positions'
              : take.exitAt === null ? 'nobody bidding'
              : take.format(take.exitAt)}
          </span>
        </div>

        {/* Once the window is done there is no book to sell into and the money
            is redeemed, not traded. Offering a key that cannot work is worse
            than offering none — see the sentence above it. */}
        {take.tradeable && (
          <Key className="action" disabled={take.pending !== null || take.exitAt === null}
               onPress={() => void take.exit()}>
            {take.pending ? 'selling…' : 'Sell back'}
          </Key>
        )}

        {take.error ? <Fault error={take.error} /> : null}
      </div>
    );
  }

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
