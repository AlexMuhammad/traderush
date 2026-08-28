import { price } from '../engine/market';

/** The engraved header and the question strip: which race, how many are in it,
 *  when it settles, and the one number that decides everything. */
export function Marquee({
  asset, interval, riders, expiryLabel, strike,
}: {
  asset: string; interval: string; riders: string; expiryLabel: string; strike: number;
}) {
  return (
    <>
      <div className="maker eng">
        <span>The Run · {asset} {interval}</span>
        <span>{riders}</span>
      </div>
      <div className="q">
        <span className="exp">{expiryLabel}</span>
        Stay on the right side of <b>{price(strike)}</b>
      </div>
    </>
  );
}
