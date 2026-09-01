import { MarketDiscovery } from '@traderush/sdk';
import { cfg } from './env.js';

/**
 * Would an order cross right now?
 *
 * This path has failed four different ways — a lot size taken from config, a
 * limit priced off the mid, a fill field guessed from prose, and a touch read
 * from an indexer that was a full point behind the chain. Each time the answer
 * was on the chain and nobody had asked it. So: ask it.
 *
 *   pnpm probe:book
 */
const d = new MarketDiscovery(cfg);
const live = await d.listLive();
const scale = BigInt(10 ** cfg.decimals);
const pct = (raw: bigint) => (Number(raw) / Number(scale) * 100).toFixed(2) + '%';
const max = (a: bigint, b: bigint) => (a > b ? a : b);

for (const m of live.slice(0, 4)) {
  const book = await (d.client as any).getBinaryOrderBook(m.ref.poolAddress, { depth: 1, decimals: cfg.decimals });
  const grid = await (d.client as any).getBinaryBookParams(m.ref.poolAddress);
  const tick = BigInt(grid.tickSize);
  const ask = book.yesAsks[0]?.price as bigint | undefined;
  const bid = book.yesBids[0]?.price as bigint | undefined;

  const limit = (longYes: boolean, touch: bigint) => {
    const pad = max(touch * 300n / 10_000n, tick * 10n);
    const wanted = longYes ? touch + pad : touch - pad;
    return longYes
      ? ((wanted + tick - 1n) / tick) * tick
      : (wanted / tick) * tick;
  };
  // The submitter clamps into (0, 1) — a binary price cannot sit on the ends.
  const clamped = (v: bigint) => v < tick ? tick : v > scale - tick ? scale - tick : v;

  console.log(`\n${m.symbol} ${m.intervalSec}s  pool ${m.ref.poolAddress.slice(0, 10)}`);
  if (ask === undefined && bid === undefined) { console.log('  book empty — nothing to cross'); continue; }
  if (ask !== undefined) {
    const L = clamped(limit(true, ask));
    console.log(`  buy UP    ask ${pct(ask)}  → limit ${pct(L)}  ${L >= ask ? 'CROSSES' : 'MISSES'}`);
  } else console.log('  buy UP    no asks');
  if (bid !== undefined) {
    const L = clamped(limit(false, bid));
    console.log(`  buy DOWN  bid ${pct(bid)}  → limit ${pct(L)}  ${L <= bid ? 'CROSSES' : 'MISSES'}`);
  } else console.log('  buy DOWN  no bids');
}
process.exit(0);
