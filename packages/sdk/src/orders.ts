import {
  quoteBinaryStakeOverBook, quoteBinarySellOverBook,
  type BinaryBuySide, type BinarySellSide, type BinarySide, type OrderFill,
  type PlaceOrderParams, type PlaceOrderResult, type Trader,
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
  /** Pools this wallet has already granted the builder on. The approval lives on
   *  the pool, and pools are recycled across windows, so one grant covers many. */
  const approvedFor = new Set<string>();
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

      // The four-sided book, by eth_call.
      //
      // NOT the live mirror. That one is a store the client keeps warm from a
      // subscription, so it reads empty until the subscription has caught up —
      // which is every short-lived process and every first order after a page
      // load. A round trip is cheaper than an order that says the book is empty
      // when it is not.
      const book = await discovery.client.getBinaryOrderBook(ref.poolAddress, {
        depth: 20, decimals: cfg.decimals,
      });

      // The venue's own sweep, rather than the one this file used to walk by
      // hand. It buys down the asks cheapest-first, stops when the next level
      // would push the escrow past the stake, pads the protective limit so the
      // IOC still crosses if the book ticks up before it lands, aligns to the
      // tick grid and snaps the quantity DOWN to a whole lot.
      //
      // Every one of those steps was written here and two of them were written
      // wrong — a limit off the top of book that failed whenever the top moved,
      // and a quantity off a lot size taken from config. This is the function
      // that exists for it.
      const params = { tickSize: grid.tickSize, lotSize: grid.lotSize, minQuantity: grid.minQuantity };
      const quote = order.action === 'buy'
        // A budget becomes a quantity: sweep the asks cheapest-first while the
        // escrow at the worst level touched still fits inside the stake.
        ? quoteBinaryStakeOverBook(
            book, (longYes ? 'BUY_YES' : 'BUY_NO') as BinaryBuySide,
            order.amount, scale, params,
          )
        // A quantity becomes proceeds: sweep the bids, best first.
        : quoteBinarySellOverBook(
            book, (order.side === 'up' ? 'SELL_YES' : 'SELL_NO') as BinarySellSide,
            order.amount, scale, params,
          );

      if (!quote) {
        throw new Error(order.action === 'buy'
          ? (longYes
              ? 'nothing offered on this side of the book'
              : 'nobody bidding on this side of the book')
          : 'nobody is bidding for this position yet');
      }

      // Never past the market's own end. The caller asks for a dead-man's switch
      // a few seconds out; on a short window that is already beyond expiry, and
      // the pool refuses the whole order rather than clamping it.
      const marketEndNs = BigInt(hit.expiryTime) * 1_000_000_000n;
      const nowNs = BigInt(Date.now()) * 1_000_000n;
      if (marketEndNs <= nowNs) throw new Error('this window has already closed');
      const expiry = order.expireTimestampNs > marketEndNs ? marketEndNs : order.expireTimestampNs;

      // A stake that cannot buy one lot is not an order, and the venue says so
      // by quoting nothing.
      const quantity = quote.quantity;
      const yesPrice = quote.yesPrice;

      const side: BinarySide = order.action === 'buy'
        ? (order.side === 'up' ? 'BUY_YES' : 'BUY_NO')
        : (order.side === 'up' ? 'SELL_YES' : 'SELL_NO');

      // Routing attribution, when this build is configured for it. The grant is
      // per pool and rides along with the first order on that pool rather than
      // standing in front of it — the same reasoning as every other approval
      // here: nobody decides an approval, they decide the thing it enables.
      const builder = cfg.builderAddress;
      const fee = cfg.builderFeeBpsTimes1k;
      if (builder && fee > 0n && !approvedFor.has(ref.poolAddress)) {
        await trader().approveBuilder({
          pool: ref.poolAddress,
          builder,
          maxFeeBpsTimes1k: fee,
        });
        approvedFor.add(ref.poolAddress);
      }

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
        ...(builder && fee > 0n ? { builder, builderFeeBpsTimes1k: fee } : {}),
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
