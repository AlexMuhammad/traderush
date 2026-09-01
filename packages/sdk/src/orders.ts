import type {
  BinarySide, OrderFill, PlaceOrderParams, PlaceOrderResult, Trader,
} from '@somnia-chain/markets-sdk';
import type { Account, PublicClient, WalletClient } from 'viem';
import type { TradeRushConfig } from './config.js';
import type { MarketDiscovery } from './discovery.js';
import type { OrderSubmitter } from './market.js';

/**
 * Book orders, signed by the connected wallet.
 *
 * The venue's own client does the sending; this is only the translation between
 * our vocabulary and theirs, and every line of it is a place a wrong conversion
 * costs money:
 *
 *   - The pool. Orders are placed against a BinaryPool address, not the market
 *     id we key everything else by, and pools are RECYCLED across windows. The
 *     ref carries the right one for this window.
 *
 *   - The price is always quoted in YES terms. Backing DOWN at 30c is a buy of
 *     NO, and the price the pool wants for it is the YES price — 70c. Passing
 *     30 there would be an order at a price nobody is offering.
 *
 *   - A taker crosses the FAR side of the book, never the mid. Buying UP lifts
 *     the ask; buying DOWN is selling YES, so it hits the bid. Sent at the mid —
 *     which is what the caller computes — the order matches nothing and the pool
 *     answers `ImmediateOrCancelNoFill`.
 *
 *   - The expiry cannot outlive the market. A binary pool requires
 *     `0 < expireNs <= marketExpiryNs` and rejects anything past it with
 *     `OrderExpiryBeyondMarket` — which a thirty second dead-man's switch trips
 *     on every window with less than thirty seconds left, i.e. half the life of
 *     a sixty second dial.
 *
 *   - And the touch is read from the POOL, not from the indexer. On a live
 *     market the two disagreed by a full point — indexer 95.40/97.80 against a
 *     real 96.40/98.50 — which is enough to land a padded limit inside the
 *     spread and cross nothing. The indexer is for showing; the chain is for
 *     signing.
 *
 *   - Immediate-or-cancel. This is taker flow: a resting order on a sixty second
 *     window is an order that expires unfilled, and the console cannot show a
 *     position that may or may not exist.
 *
 *   - The grid is the POOL'S, read from the pool. Our config carried a tick and
 *     a lot with a comment saying binary pools do not publish them; they do, via
 *     `getBinaryBookParams`, and the config's lot of 1 against a real lot of
 *     1000 is what made the chain answer `InvalidQuantity(5917159, 1000)`.
 */
export function makeOrderSubmitter(opts: {
  cfg: TradeRushConfig;
  discovery: MarketDiscovery;
  wallet: WalletClient;
  account: Account;
  publicClient: PublicClient;
}): OrderSubmitter {
  const { cfg, discovery, wallet, account, publicClient } = opts;

  // Built on first use and kept: it caches pool lookups and token approvals, and
  // rebuilding it per order throws that away.
  let cached: Trader | null = null;
  const trader = (): Trader => (cached ??= discovery.client.createTrader({
    walletClient: wallet,
    account,
    publicClient,
    decimals: cfg.decimals,
  }));

  return {
    async submit(order) {
      const hit = await discovery.get(order.marketId);
      const ref = hit?.ref;
      if (!ref) throw new Error(`market ${order.marketId} is not in the indexer`);

      // Ours is a probability on the collateral grid; theirs is the YES price on
      // the same grid. For a NO order those are complements, not the same number.
      const scale = 10n ** BigInt(cfg.decimals);

      // What this pool will actually accept. Read once per pool and cached by
      // the venue client; a guess here is a reverted transaction.
      const grid = await bookParams(discovery, ref.poolAddress);

      // Which way is aggressive, in YES terms. Buying UP and selling DOWN are
      // both "long YES" and cross upward; the other two cross downward.
      const longYes = (order.action === 'buy') === (order.side === 'up');

      // The real resting book, in raw units — no float anywhere on this path.
      const book = await discovery.client.getBinaryOrderBook(ref.poolAddress, {
        depth: 8, decimals: cfg.decimals,
      });
      const levels = longYes ? book.yesAsks : book.yesBids;
      if (!levels.length) {
        throw new Error(longYes
          ? 'nothing offered on this side of the book'
          : 'nobody bidding on this side of the book');
      }

      // Walk down as far as this order actually needs, and price against THAT
      // level rather than the touch.
      //
      // A limit that only clears the top of book is a limit that fails whenever
      // the top of book moves — which on a sixty second window is most of the
      // time; measured, two orders in five came back ImmediateOrCancelNoFill.
      // Crossing costs the MAKER'S price, not the limit, so reaching deeper is
      // free when the depth is not needed and is the difference between a fill
      // and a revert when it is.
      let taken = 0n;
      let deepest = levels[0]!.price;
      for (const level of levels) {
        deepest = level.price;
        taken += level.quantity;
        if (taken >= order.size) break;
      }

      // Then a cushion past that, because the level can still move between the
      // read and the transaction landing. Three percent, floored at ten ticks so
      // a long shot — where the percentage rounds to almost nothing — still gets
      // real slack.
      const pad = max(deepest * 300n / 10_000n, grid.tickSize * 10n);
      const wanted = longYes ? deepest + pad : deepest - pad;

      // Snap the way that keeps it crossing: rounding a buy limit down, or a
      // sell limit up, can land it back inside the spread. Then clamp — a
      // binary price is strictly inside (0, 1) and the pool rejects the ends.
      const snapped = longYes
        ? ((wanted + grid.tickSize - 1n) / grid.tickSize) * grid.tickSize
        : (wanted / grid.tickSize) * grid.tickSize;
      const yesPrice = clamp(snapped, grid.tickSize, scale - grid.tickSize);

      // Never past the market's own end. The caller asks for a dead-man's switch
      // a few seconds out; on a short window that is already beyond expiry, and
      // the pool refuses the whole order rather than clamping it.
      const marketEndNs = BigInt(hit.expiryTime) * 1_000_000_000n;
      const nowNs = BigInt(Date.now()) * 1_000_000n;
      if (marketEndNs <= nowNs) throw new Error('this window has already closed');
      const expiry = order.expireTimestampNs > marketEndNs ? marketEndNs : order.expireTimestampNs;

      const quantity = (order.size / grid.lotSize) * grid.lotSize;
      if (quantity === 0n) {
        throw new Error(`too small — this book trades in lots of ${grid.lotSize}`);
      }
      if (grid.minQuantity > 0n && quantity < grid.minQuantity) {
        throw new Error(`below this book's minimum order of ${grid.minQuantity}`);
      }

      const side: BinarySide = order.action === 'buy'
        ? (order.side === 'up' ? 'BUY_YES' : 'BUY_NO')
        : (order.side === 'up' ? 'SELL_YES' : 'SELL_NO');

      const res: PlaceOrderResult = await trader().placeOrder({
        pool: ref.poolAddress,
        side,
        price: yesPrice,
        quantity,
        yesId: ref.upId,
        noId: ref.downId,
        // 2 = ImmediateOrCancel. Taker flow, and the only kind this console can
        // honestly report on: anything left resting is a position it would have
        // to show as "maybe".
        orderType: order.timeInForce === 'IOC' ? 2 : 0,
        expireTimestampNs: expiry,
      } satisfies PlaceOrderParams);

      return {
        txHash: res.hash,
        // What actually crossed. A partial fill is normal on a thin book and the
        // caller has to know the real size, not the one it asked for.
        filled: sumFilled(res.fills ?? []),
      };
    },
  };
}

const max = (a: bigint, b: bigint) => (a > b ? a : b);
const clamp = (v: bigint, lo: bigint, hi: bigint) => (v < lo ? lo : v > hi ? hi : v);

/** The pool's tick, lot and minimum. One chain read, cached by the client. */
async function bookParams(discovery: MarketDiscovery, pool: `0x${string}`) {
  const client = discovery.client as unknown as {
    getBinaryBookParams(pool: string): Promise<{ tickSize: bigint; lotSize: bigint; minQuantity: bigint }>;
  };
  const p = await client.getBinaryBookParams(pool);
  return {
    tickSize: BigInt(p.tickSize),
    lotSize: BigInt(p.lotSize),
    minQuantity: BigInt(p.minQuantity ?? 0n),
  };
}

/**
 * Total quantity that crossed, across however many levels it took.
 *
 * The field is `quantityFilled`. It was written here as `quantity` — a shape
 * guessed from the prose rather than taken from the type — so a placement that
 * actually succeeded died reading its own receipt.
 */
function sumFilled(fills: OrderFill[]): bigint {
  return fills.reduce((n, f) => n + f.quantityFilled, 0n);
}
