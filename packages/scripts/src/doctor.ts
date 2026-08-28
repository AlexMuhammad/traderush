/** M1 gate. Verifies the ACTIVE network end to end: RPC, deployment map, collateral,
 *  and the escrow. Run it before anything else, and again after switching NETWORK.
 *
 *      pnpm doctor                 # testnet (default)
 *      NETWORK=mainnet pnpm doctor # mainnet
 *
 *  Nothing here is simulated (§11). Failures are printed, not papered over.
 */
import { createPublicClient, http, formatUnits } from 'viem';
import { MarketAdapter, RestClient, erc20Abi, binaryMarketsModuleAbi } from '@bullrun/sdk';
import { cfg, fmt } from './env.js';

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function main() {
  console.log(fmt.head(`BULLRUN doctor — network: ${cfg.network.toUpperCase()}`));
  if (cfg.network === 'mainnet') {
    console.log(fmt.warn('MAINNET. Collateral is real USDso. This code is unaudited.'));
  }
  console.log(`chainId   ${cfg.chainId}`);
  console.log(`rpc       ${cfg.rpcUrl}`);
  console.log(`indexer   ${cfg.indexerUrl}`);
  console.log(`rest      ${cfg.restUrl}   (spot/perp only — see step 3)`);
  console.log(`venueId   ${cfg.venueId}`);
  console.log(`tick/lot  ${cfg.tick} / ${cfg.lot}`);

  const pub = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpcUrl) });

  // --- 1. RPC on the right chain -------------------------------------------
  console.log(fmt.head('1. RPC'));
  try {
    const [id, block] = await Promise.all([pub.getChainId(), pub.getBlockNumber()]);
    console.log(id === cfg.chainId
      ? fmt.ok(`chain ${id}, head block ${block}`)
      : fmt.bad(`RPC reports chain ${id}, config says ${cfg.chainId} — WRONG NETWORK`));
  } catch (e) {
    console.log(fmt.bad(`RPC unreachable: ${msg(e)}`));
  }

  // --- 2. Deployment map: does every address actually have code? ------------
  // A stale entry must fail loudly rather than produce silent no-op calls.
  console.log(fmt.head('2. Deployment addresses'));
  for (const [name, addr] of Object.entries(cfg.addresses)) {
    try {
      const code = await pub.getCode({ address: addr });
      const size = code ? (code.length - 2) / 2 : 0;
      console.log(size > 0
        ? fmt.ok(`${name.padEnd(22)} ${addr}  (${size} bytes)`)
        : fmt.bad(`${name.padEnd(22)} ${addr}  NO CODE — stale entry in networks.ts`));
    } catch (e) {
      console.log(fmt.bad(`${name.padEnd(22)} ${addr}  ${msg(e)}`));
    }
  }

  // --- 3. Collateral: decimals are the thing that silently breaks a UI ------
  console.log(fmt.head('3. Collateral'));
  try {
    const [dec, sym] = await Promise.all([
      pub.readContract({ address: cfg.addresses.collateral, abi: erc20Abi, functionName: 'decimals' }),
      pub.readContract({ address: cfg.addresses.collateral, abi: erc20Abi, functionName: 'symbol' }),
    ]);
    console.log(Number(dec) === cfg.decimals
      ? fmt.ok(`${sym}, ${dec} decimals — matches the ${cfg.network} map`)
      : fmt.bad(`${sym} reports ${dec} decimals but networks.ts says ${cfg.decimals}. ` +
                `Every amount in the UI would be wrong by 1e${Math.abs(Number(dec) - cfg.decimals)}.`));
    if (cfg.faucet) console.log(fmt.warn(`testnet collateral has a public faucet(uint256)`));
  } catch (e) {
    console.log(fmt.bad(`collateral read failed: ${msg(e)}`));
  }

  // --- 4. Where event contracts actually live ------------------------------
  console.log(fmt.head('4. Market discovery'));
  const rest = new RestClient(cfg, cfg.apiKey);
  try {
    const raw = await rest.rawMarkets({ kind: 'all' }) as { markets?: { kind?: string; symbol?: string }[] };
    const kinds = [...new Set((raw.markets ?? []).map((m) => m.kind))];
    console.log(fmt.ok(`REST /markets reachable: ${raw.markets?.length ?? 0} rows, kinds [${kinds.join(', ')}]`));
    // Verified 2026-08-29: the `kind` enum is ["spot","perp","all"]. There is no
    // binary tier on this endpoint, on either host. PRD §2's claim that the venue
    // addresses and event contracts are "re-fetchable from GET /v0/markets" is
    // wrong — binaries come from the indexer via @somnia-chain/markets-sdk.
    console.log(fmt.warn('Event contracts are NOT on this endpoint (kind enum is spot|perp|all).'));
    console.log(fmt.warn('Binary market discovery needs @somnia-chain/markets-sdk against the indexer.'));
  } catch (e) {
    console.log(fmt.bad(`REST failed: ${msg(e)}`));
  }

  // --- 5. Escrow -----------------------------------------------------------
  console.log(fmt.head('5. DuelEscrow'));
  if (!cfg.escrowAddress) {
    console.log(fmt.warn(`DUEL_ESCROW_ADDRESS_${cfg.network.toUpperCase()} unset — not deployed on ${cfg.network} yet (M3)`));
    console.log('\nDeploy with:');
    console.log(`  COLLATERAL=${cfg.addresses.collateral} \\`);
    console.log(`  MODULE=${cfg.addresses.binaryModule} \\`);
    console.log(`  OUTCOME=${cfg.addresses.binaryModule} \\`);
    console.log(`  RPC_URL=${cfg.rpcUrl} pnpm deploy:escrow`);
  } else {
    try {
      const { DuelAdapter } = await import('@bullrun/sdk');
      const duels = new DuelAdapter(cfg, undefined, { publicClient: pub as never });
      const v = await duels.venue();
      const okCollateral = v.collateral.toLowerCase() === cfg.addresses.collateral.toLowerCase();
      const okModule = v.module.toLowerCase() === cfg.addresses.binaryModule.toLowerCase();
      console.log(fmt.ok(`${cfg.escrowAddress} deployed`));
      console.log(okCollateral ? fmt.ok(`  collateral matches`) : fmt.bad(`  collateral ${v.collateral} != map`));
      console.log(okModule ? fmt.ok(`  module matches`) : fmt.bad(`  module ${v.module} != map`));
    } catch (e) {
      console.log(fmt.bad(`escrow read failed: ${msg(e)}`));
    }
  }

  // --- 6. Module sanity ----------------------------------------------------
  console.log(fmt.head('6. Module interface (VERIFY — §4.2)'));
  try {
    await pub.readContract({
      address: cfg.addresses.binaryModule, abi: binaryMarketsModuleAbi,
      functionName: 'marketStatus', args: [`0x${'00'.repeat(32)}`],
    });
    console.log(fmt.ok('marketStatus(bytes32) exists and is callable'));
  } catch (e) {
    console.log(fmt.warn(`marketStatus probe: ${msg(e).split('\n')[0]}`));
    console.log(fmt.warn('The transcribed ABI may not match. Confirm against markets-sdk.'));
  }

  console.log(fmt.head('Next'));
  console.log('  docs/UNKNOWNS.md — the §9 blockers are still unanswered');
  console.log('  pnpm probe — answers #1 and #3 once the escrow is deployed');
  void formatUnits;
}

main().catch((e) => { console.error(e); process.exit(1); });
