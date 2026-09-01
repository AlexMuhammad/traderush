import { MarketDiscovery, MarketAdapter, makeOrderSubmitter } from '@traderush/sdk';
import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, http } from 'viem';
import { cfg, requireEnv } from './env.js';

/**
 * Place ONE minimum order through the real submitter and report what happened.
 *
 * Reasoning about this path has been wrong three times. A single lot on testnet
 * costs nothing and answers the question outright.
 *
 *   pnpm probe:order
 */
const account = privateKeyToAccount(requireEnv('PRIVATE_KEY_A') as `0x${string}`);
const d = new MarketDiscovery(cfg);
const market = new MarketAdapter(cfg);
const wallet = createWalletClient({ chain: cfg.chain, transport: http(cfg.rpcUrl), account });

market.setOrderSubmitter(makeOrderSubmitter({
  cfg, discovery: market.discovery, wallet, account, publicClient: market.publicClient,
}));

// Shortest window first — that is the dial the console opens on, and a 60s book
// behaves nothing like a 15m one.
const live = (await market.listMarkets()).sort((a, b) => a.intervalSec - b.intervalSec);
const scale = Number(10n ** BigInt(cfg.decimals));

for (const m of live.slice(0, 6)) {
  const book = await (d.client as any).getBinaryOrderBook(m.ref.poolAddress, { depth: 1, decimals: cfg.decimals });
  const ask = book.yesAsks[0]?.price as bigint | undefined;
  const bid = book.yesBids[0]?.price as bigint | undefined;
  const side = ask !== undefined ? 'up' : bid !== undefined ? 'down' : null;
  const idx = (v: number | null) => v === null ? '—' : (v * 100).toFixed(2) + '%';
  console.log(`\n${m.symbol} ${m.intervalSec}s  indexer bid ${idx(m.bestBid)} ask ${idx(m.bestAsk)}`);
  if (!side) { console.log('  chain book EMPTY — nothing to cross'); continue; }

  const pct = (v: bigint | undefined) => v === undefined ? '—' : (Number(v) / scale * 100).toFixed(2) + '%';
  console.log(`  chain   bid ${pct(bid)} ask ${pct(ask)}  → buying ${side.toUpperCase()}`);

  // Exactly what the submitter will compute, printed before it is sent.
  const grid = await (d.client as any).getBinaryBookParams(m.ref.poolAddress);
  const tick = BigInt(grid.tickSize);
  const touch = side === 'up' ? ask! : bid!;
  const pad = (touch * 300n / 10_000n) > tick * 10n ? touch * 300n / 10_000n : tick * 10n;
  const wanted = side === 'up' ? touch + pad : touch - pad;
  const snapped = side === 'up' ? ((wanted + tick - 1n) / tick) * tick : (wanted / tick) * tick;
  const S = BigInt(scale);
  const limit = snapped < tick ? tick : snapped > S - tick ? S - tick : snapped;
  const depth = (side === 'up' ? book.yesAsks[0] : book.yesBids[0]);
  console.log(`  touch ${pct(touch)} pad ${pct(pad)} → limit ${pct(limit)}  ${side === 'up' ? (limit >= touch ? 'crosses' : 'MISSES') : (limit <= touch ? 'crosses' : 'MISSES')}`);
  console.log(`  level qty ${String(depth?.quantity)}  lot ${String(tick)}  expires ${m.expiryTime - Math.floor(Date.now() / 1000)}s`);

  try {
    // One tUSDC. The submitter snaps it to the pool's own lot.
    const pos = await market.buy(m.marketId as `0x${string}`, side, BigInt(scale));
    console.log('  OK  filled', String(pos.size), 'tx', pos.txHash);
  } catch (e) {
    console.log('  FAILED', (e as Error).message.split('\n')[0]);
  }
  break;
}
process.exit(0);
