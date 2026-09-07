/**
 * `pnpm maker` — post two-sided quotes on the shortest live windows.
 *
 * Everything else this repo does is taker flow, and the cost of that shows up
 * as the one failure we could not code our way out of: on a sixty second
 * window a third of orders came back ImmediateOrCancelNoFill, because the book
 * is thin and the resting orders vanish faster than a transaction lands. The
 * venue pays yield for posting tight quotes. Nobody was posting.
 *
 * So this is the other half of the venue we were not using: resting orders
 * (orderType 0), cancelled and re-posted as the window moves, and cancelled on
 * the way out so nothing is left behind.
 *
 * Quoting BOTH sides needs inventory. A bid escrows collateral, which the wallet
 * has; an ask escrows the outcome token itself, which it does not — so the first
 * version could only ever post bids. `mintSet` deposits collateral and returns
 * an equal YES and NO, which is exactly the inventory an ask needs and is the
 * same primitive the room escrow already runs on. It is burned back on the way
 * out, so the capital is borrowed for the run and not left in tokens.
 *
 *   pnpm maker              one pass over every live window
 *   pnpm maker -- --watch   re-quote every 20s until interrupted
 *
 * It signs with the MAKER wallet (`MAKER_PRIVATE_KEY`, else PRIVATE_KEY_B) and
 * never with the wallet you play on — its fills are real positions and they
 * belong to whoever signed them. It is a REAL market maker: it can be picked
 * off. Quote what you are willing to be filled on.
 */
import { createPublicClient, createWalletClient, http, formatUnits, type PublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { MarketAdapter, binarySettlementAbi, erc6909Abi } from '@traderush/sdk';
import { cfg, fmt, requireEnv } from './env.js';

/** How far either side of the mid to sit, in raw collateral units. */
const EDGE = 20_000n;
/** Outcome tokens per quote. */
const SIZE = 5_000_000n;
/** Pools this run minted inventory on, and how much, so it can be burned back. */
const minted = new Map<`0x${string}`, bigint>();
/** Never quote a window with less than this left — it cannot be unwound. */
const MIN_LEFT = 45;

const watch = process.argv.includes('--watch');

/**
 * The maker signs as SOMEBODY ELSE, and that is the point.
 *
 * This used to sign with PRIVATE_KEY_A — the wallet a person plays on. A market
 * maker rests orders every twenty seconds and gets filled, so every one of those
 * fills landed in that player's own Positions and History. From inside the
 * console it read exactly like the account placing bets by itself, which is what
 * it was, just not by the person holding it.
 *
 * Liquidity has to come from an account that is not the one watching the screen.
 * `MAKER_PRIVATE_KEY` if it is set, otherwise PRIVATE_KEY_B — the second wallet
 * this repo already keeps for the two-sided scripts, and never A.
 */
const MAKER_KEY = process.env.MAKER_PRIVATE_KEY?.trim() || requireEnv('PRIVATE_KEY_B');
const A = privateKeyToAccount(MAKER_KEY as `0x${string}`);

// Said out loud on every run, because a maker you have forgotten is quoting is
// a maker that can be picked off, and because its fills belong to this address
// and nobody else's.
console.log(fmt.warn(`quoting as ${A.address} — the maker wallet, not your player wallet`));
const pub = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpcUrl) }) as PublicClient;
const wallet = createWalletClient({ account: A, chain: cfg.chain, transport: http(cfg.rpcUrl) });
const market = new MarketAdapter(cfg, { publicClient: pub });
const client = market.discovery.client as any;
const trader = client.createTrader({
  walletClient: wallet, account: A, publicClient: pub, decimals: cfg.decimals,
});

const scale = 10n ** BigInt(cfg.decimals);
const pct = (v: bigint) => (Number(v) / Number(scale) * 100).toFixed(2) + '%';
const clamp = (v: bigint, lo: bigint, hi: bigint) => (v < lo ? lo : v > hi ? hi : v);

/** What this wallet holds of one outcome id — the escrow an ask needs. */
let outcomeToken: `0x${string}` | null = null;
async function outcomeBalance(id: bigint): Promise<bigint> {
  outcomeToken ??= await pub.readContract({
    address: cfg.addresses.binarySettlement, abi: binarySettlementAbi, functionName: 'outcomeToken',
  }) as `0x${string}`;
  return pub.readContract({
    address: outcomeToken, abi: erc6909Abi, functionName: 'balanceOf', args: [A.address, id],
  }) as Promise<bigint>;
}

/** Orders this run put on the book, so they can be taken off again. */
const resting: { pool: `0x${string}`; orderId: bigint }[] = [];

async function quoteOne(m: Awaited<ReturnType<typeof market.listMarkets>>[number]): Promise<void> {
  const left = m.expiryTime - Math.floor(Date.now() / 1000);
  if (left < MIN_LEFT) return;

  const pool = m.ref.poolAddress;
  const grid = await client.getBinaryBookParams(pool);
  const tick = BigInt(grid.tickSize);
  const snap = (v: bigint) => (v / tick) * tick;

  // Around the book's own mid where there is one, and around the implied
  // probability where there is not — a market nobody has quoted is exactly the
  // one worth quoting.
  const mid = BigInt(Math.round(m.upPrice * Number(scale)));
  const bid = clamp(snap(mid - EDGE), tick, scale - tick);
  const ask = clamp(snap(mid + EDGE), tick, scale - tick);
  if (bid >= ask) return;

  // The expiry has to sit inside the market's own, or the pool refuses it.
  const expireNs = BigInt(m.expiryTime) * 1_000_000_000n;

  // A bid escrows collateral; an ask escrows the outcome token itself. So the
  // ask side needs inventory, and minting a complete set is how you get it —
  // collateral in, an equal YES and NO out, both of them yours to quote.
  let held = await outcomeBalance(m.ref.upId);
  if (held < SIZE) {
    const short = SIZE - held;
    try {
      await trader.mintSet({ pool, amount: short });
      minted.set(pool, (minted.get(pool) ?? 0n) + short);
      held = await outcomeBalance(m.ref.upId);
      console.log(fmt.ok(`${m.symbol} ${m.intervalSec}s  minted ${formatUnits(short, cfg.decimals)} of inventory`));
    } catch (e) {
      console.log(fmt.warn(`${m.symbol} ${m.intervalSec}s  bid only — ${(e as Error).message.split('\n')[0]}`));
    }
  }

  const sides: readonly (readonly ['BUY_YES' | 'SELL_YES', bigint])[] = held >= SIZE
    ? [['BUY_YES', bid], ['SELL_YES', ask]]
    : [['BUY_YES', bid]];

  for (const [side, price] of sides) {
    try {
      const res = await trader.placeOrder({
        pool, side, price, quantity: SIZE,
        yesId: m.ref.upId, noId: m.ref.downId,
        orderType: 0,                       // rest, do not cross
        expireTimestampNs: expireNs,
      });
      if (res.orderId) resting.push({ pool, orderId: res.orderId });
      console.log(fmt.ok(`${m.symbol} ${m.intervalSec}s  ${side.padEnd(9)} ${pct(price)}  ${res.orderId ? `#${res.orderId}` : 'filled on arrival'}`));
    } catch (e) {
      console.log(fmt.bad(`${m.symbol} ${m.intervalSec}s  ${side.padEnd(9)} ${pct(price)}  ${(e as Error).message.split('\n')[0]}`));
    }
  }
}

async function pass(): Promise<void> {
  live = (await market.listMarkets()).sort((a, b) => a.intervalSec - b.intervalSec);
  console.log(fmt.head(`quoting ${live.length} windows · ${formatUnits(await market.balance(A.address), cfg.decimals)} ${cfg.collateralSymbol}`));
  for (const m of live) await quoteOne(m);
}

/** Leave nothing resting. An abandoned quote is a position somebody else gets
 *  to choose the moment to take. */
async function cleanup(): Promise<void> {
  if (!resting.length) return;
  console.log(fmt.head(`cancelling ${resting.length} orders`));
  for (const o of resting.splice(0)) {
    await trader.cancelOrder({ pool: o.pool, orderId: o.orderId }).catch(() => {});
  }
}

/**
 * Hand the inventory back.
 *
 * Burning a set needs an EQUAL YES and NO, and a filled ask leaves them uneven —
 * so this burns what is still paired and leaves the rest, which is the position
 * the quoting actually took. Capital borrowed for the run comes home; capital
 * that became a trade stays a trade.
 */
async function unwind(): Promise<void> {
  if (!minted.size) return;
  console.log(fmt.head('burning inventory back to collateral'));
  for (const [pool, amount] of minted) {
    const m = live.find((x) => x.ref.poolAddress === pool);
    if (!m) continue;
    const [yes, no] = await Promise.all([outcomeBalance(m.ref.upId), outcomeBalance(m.ref.downId)]);
    const paired = yes < no ? yes : no;
    const burn = paired < amount ? paired : amount;
    if (burn === 0n) continue;
    await trader.burnSet({ pool, amount: burn })
      .then(() => console.log(fmt.ok(`${m.symbol} ${m.intervalSec}s  burned ${formatUnits(burn, cfg.decimals)}`)))
      .catch((e: unknown) => console.log(fmt.bad(`${m.symbol} ${m.intervalSec}s  ${(e as Error).message.split('\n')[0]}`)));
  }
  minted.clear();
}

process.on('SIGINT', () => {
  void cleanup().then(unwind).then(() => process.exit(0));
});

let live: Awaited<ReturnType<typeof market.listMarkets>> = [];
await pass();
if (watch) {
  console.log(fmt.head('watching — ctrl-c to pull the quotes'));
  for (;;) {
    await new Promise((r) => setTimeout(r, 20_000));
    await cleanup();
    await pass();
  }
}
await cleanup();
await unwind();
market.close();
process.exit(0);
