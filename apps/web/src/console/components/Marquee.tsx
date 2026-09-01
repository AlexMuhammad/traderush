import { price } from '../engine/market';
import { MenuKey } from './MenuKey';

/** The engraved header and the question strip: which race, how many are in it,
 *  when it settles, and the one number that decides everything. */
export function Marquee({
  asset, interval, riders, expiryLabel, strike, onOpenMenu, menuOpen,
}: {
  asset: string; interval: string; riders: string; expiryLabel: string; strike: number;
  onOpenMenu: () => void;
  /** So the key can say whether it opens or closes. */
  menuOpen?: boolean;
}) {
  return (
    <>
      <div className="maker eng">
        <span className="maker__mark">
          {/* The badge is pixel art: it is rendered at a size the source divides
              into, and told not to smooth, or the horns turn to fog. */}
          <img src="/favicon.png" alt="" width={16} height={16} />
          Trade Rush · {asset} {interval}
        </span>
        <span className="maker__right">
          {riders}
          <MenuKey onOpen={onOpenMenu} open={menuOpen} />
        </span>
      </div>
      <div className="q">
        <span className="exp">{expiryLabel}</span>
        Stay on the right side of <b>{price(strike)}</b>
      </div>
    </>
  );
}
