/** M1 acceptance: `doctor` prints a LIVE market list.
 *
 *  Everything here reads the real venue. Nothing is simulated (§11). If a call fails,
 *  the failure is printed — it is not papered over with a placeholder. */
import { createPublicClient, http } from 'viem';
import { MarketAdapter, RestClient, shannon } from '@bullrun/sdk';
import { cfg, fmt } from './env.js';

async function main() {
  console.log(fmt.head('BULLRUN doctor — Shannon testnet only'));
  console.log(`chainId ${cfg.chainId}   rpc ${cfg.rpcUrl}`);
  console.log(`rest    ${cfg.restUrl}`);
  console.log(`ws      ${cfg.wsUrl}`);

  // --- 1. RPC reachable and on the right chain -------------------------------
  console.log(fmt.head('1. RPC'));
  const pub = createPublicClient({ chain: shannon, transport: http(cfg.rpcUrl) });
  try {
    const [id, block] = await Promise.all([pub.getChainId(), pub.getBlockNumber()]);
    if (id !== cfg.chainId) {
      console.log(fmt.bad(`RPC reports chain ${id}, expected ${cfg.chainId} — WRONG NETWORK`));
    } else {
      console.log(fmt.ok(`chain ${id}, head block ${block}`));
    }
  } catch (e) {
    console.log(fmt.bad(`RPC unreachable: ${msg(e)}`));
  }

  // --- 2. REST: the live market list ----------------------------------------
  console.log(fmt.head('2. GET /v0/markets'));
  const rest = new RestClient(cfg, process.env.DREAMDEX_API_KEY);
  let markets: Awaited<ReturnType<RestClient['listMarkets']>> = [];
  try {
    markets = await rest.listMarkets();
    console.log(fmt.ok(`${markets.length} markets`));
  } catch (e) {
    console.log(fmt.bad(`markets failed: ${msg(e)}`));
    console.log(fmt.warn('Raw payload follows so you can fix the normalizer in packages/sdk/src/rest.ts:'));
    try { console.log(JSON.stringify(await rest.rawMarkets(), null, 2).slice(0, 4000)); }
    catch { /* already reported */ }
  }

  if (markets.length) {
    const now = Math.floor(Date.now() / 1000);
    const rows = markets.slice(0, 25).map((m) => ({
      marketId: m.marketId.slice(0, 12) + '…',
      asset: m.symbol,                      // §8.9 — typed field
      intervalSec: m.intervalSec,           // §8.9 — typed field
      status: m.status,
      strike: m.strike,
      spot: m.spot,
      up: m.upPrice,
      down: m.upPrice ? +(1 - m.upPrice).toFixed(4) : 0,
      expiresIn: m.expiryTime ? `${m.expiryTime - now}s` : '?',
    }));
    console.table(rows);

    const trading = markets.filter((m) => m.status === 'Trading');
    console.log(trading.length
      ? fmt.ok(`${trading.length} Trading — these accept orders and mints`)
      : fmt.warn('no market is Trading right now; only Trading accepts orders and mints (§2)'));

    // §9 non-blocking: are BTC/ETH event contracts live, and with what depth?
    for (const asset of ['BTC', 'ETH']) {
      const hit = markets.filter((m) => m.symbol.toUpperCase().includes(asset));
      console.log(hit.length
        ? fmt.ok(`${asset}: ${hit.length} market(s), intervals ${[...new Set(hit.map((m) => m.intervalSec))].join('/')}s`)
        : fmt.warn(`${asset}: no market found`));
    }

    // Gotcha §8.8 — the default sweep hides settled markets.
    try {
      const finalized = await rest.listFinalizedMarkets();
      console.log(fmt.ok(`${finalized.length} finalized markets (queried explicitly — §8.8)`));
    } catch (e) {
      console.log(fmt.warn(`finalized query failed: ${msg(e)}`));
    }
  }

  // --- 3. Venue addresses, fetched at runtime (§2) ---------------------------
  console.log(fmt.head('3. Venue addresses (runtime-fetched, never hard-coded)'));
  try {
    const adapter = new MarketAdapter(cfg, { apiKey: process.env.DREAMDEX_API_KEY });
    const a = await adapter.addresses();
    console.log(fmt.ok(`collateral   ${a.collateral}`));
    console.log(fmt.ok(`module       ${a.module}`));
    console.log(fmt.ok(`outcomeToken ${a.outcomeToken}`));
    adapter.close();
    console.log('\nDeploy with:');
    console.log(`  COLLATERAL=${a.collateral} MODULE=${a.module} OUTCOME=${a.outcomeToken} pnpm deploy:escrow`);
  } catch (e) {
    console.log(fmt.bad(msg(e)));
  }

  // --- 4. Escrow, if deployed ----------------------------------------------
  console.log(fmt.head('4. DuelEscrow'));
  if (!cfg.escrowAddress) {
    console.log(fmt.warn('DUEL_ESCROW_ADDRESS unset — not deployed yet (M3)'));
  } else {
    try {
      const { DuelAdapter } = await import('@bullrun/sdk');
      const duels = new DuelAdapter(cfg);
      const v = await duels.venue();
      console.log(fmt.ok(`${cfg.escrowAddress} wired to collateral ${v.collateral}, module ${v.module}, outcome ${v.outcome}`));
    } catch (e) {
      console.log(fmt.bad(`escrow read failed: ${msg(e)}`));
    }
  }

  console.log(fmt.head('§9 blocking unknowns'));
  console.log('Run `pnpm probe` and write the answers into docs/UNKNOWNS.md before contract logic.');
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

main().catch((e) => { console.error(e); process.exit(1); });
