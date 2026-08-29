/** §9 — the blocking unknowns.
 *
 *  #3 is ANSWERED and needs no probe: the indexer supplies yesTokenId/noTokenId
 *     on every market row, and they equal outcomeId(pool, nonce, idx). Verified
 *     against ten live Shannon markets.
 *
 *  Two remain, and both are about whether the duel design is even possible:
 *
 *  #1 Can a CONTRACT call mintCompleteSet while holding user funds, or is it
 *     caller-funded only?          -> if NO, use the §4.4 swap fallback
 *  #2 Can ANY ERC-6909 holder redeem a winning leg, or only the minter?
 *     -> if NO, the duel design collapses. Escalate.
 *
 *  Run against a SHORT market so an answer arrives the same day.
 */
import { createPublicClient, http, encodeFunctionData, type PublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  MarketAdapter, binaryModuleWriteAbi, binaryModuleReadAbi, binarySettlementAbi,
  erc6909Abi, erc20Abi, MARKET,
} from '@traderush/sdk';
import { cfg, fmt, requireEnv } from './env.js';

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function main() {
  const account = privateKeyToAccount(requireEnv('PRIVATE_KEY_A') as `0x${string}`);
  const pub = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpcUrl) }) as PublicClient;
  const market = new MarketAdapter(cfg, { publicClient: pub });

  const live = await market.listMarkets();
  const trading = live
    .filter((m) => m.status === 'Trading' && m.expiryTime - Math.floor(Date.now() / 1000) > 90)
    .sort((a, b) => a.intervalSec - b.intervalSec)[0];
  if (!trading) throw new Error('no Trading market with runway — rerun when a window has just opened');

  const ref = trading.ref;
  console.log(fmt.head('probe market'));
  console.log(`${trading.symbol} ${trading.intervalSec}s  strike ${trading.strike}  spot ${trading.spot}`);
  console.log(`marketId ${ref.marketId}`);
  console.log(`operatorId ${ref.operatorId}  venueId ${ref.venueId}`);
  console.log(`upId ${ref.upId}\ndownId ${ref.downId}`);

  // Cross-check the indexer against the chain before trusting either.
  console.log(fmt.head('on-chain record'));
  const record = await pub.readContract({
    address: cfg.addresses.binaryModule, abi: binaryModuleReadAbi,
    functionName: 'markets', args: [ref.marketId],
  }) as readonly unknown[];
  const chainYes = record[MARKET.yesId] as bigint;
  const chainNo = record[MARKET.noId] as bigint;
  console.log(chainYes === ref.upId ? fmt.ok('yesId matches the indexer') : fmt.bad(`yesId chain ${chainYes} vs indexer ${ref.upId}`));
  console.log(chainNo === ref.downId ? fmt.ok('noId matches the indexer') : fmt.bad(`noId chain ${chainNo} vs indexer ${ref.downId}`));
  console.log(`collateral ${record[MARKET.collateral]}  pool ${record[MARKET.pool]}`);
  console.log(`window ${record[MARKET.tradingStart]} → ${record[MARKET.expiry]}`);

  const outcomeToken = await pub.readContract({
    address: cfg.addresses.binarySettlement, abi: binarySettlementAbi, functionName: 'outcomeToken',
  }) as `0x${string}`;
  console.log(`outcome token (ERC-6909) ${outcomeToken}`);

  // ---------------------------------------------------------------- unknown #1
  console.log(fmt.head('#1 can a CONTRACT mint a complete set with funds it holds?'));
  const amount = 10n ** BigInt(ref.decimals);   // 1 unit of collateral
  const balance = await pub.readContract({
    address: ref.collateral, abi: erc20Abi, functionName: 'balanceOf', args: [account.address],
  }) as bigint;
  console.log(`wallet collateral: ${balance}`);

  const mintData = encodeFunctionData({
    abi: binaryModuleWriteAbi, functionName: 'mintCompleteSet',
    args: [ref.operatorId, ref.venueId, ref.marketId, amount],
  });

  // (a) from an EOA. If this fails nothing downstream means anything.
  try {
    await pub.call({ account: account.address, to: cfg.addresses.binaryModule, data: mintData });
    console.log(fmt.ok('EOA mintCompleteSet simulates cleanly'));
  } catch (e) {
    console.log(fmt.bad(`EOA mint reverts: ${msg(e)}`));
    console.log(fmt.warn('Check the collateral allowance to the module, and the balance above.'));
  }

  // (b) from the deployed escrow. This is the question: does the module care
  //     that msg.sender is a contract?
  if (cfg.escrowAddress) {
    try {
      await pub.call({ account: cfg.escrowAddress, to: cfg.addresses.binaryModule, data: mintData });
      console.log(fmt.ok('ANSWER #1 = YES — a contract can mint. Keep the §4 design.'));
    } catch (e) {
      console.log(fmt.bad(`contract-sender mint reverts: ${msg(e)}`));
      console.log(fmt.warn('If this is access control rather than balance/allowance: ANSWER #1 = NO -> §4.4 swap fallback.'));
    }
  } else {
    console.log(fmt.warn(`DUEL_ESCROW_ADDRESS_${cfg.network.toUpperCase()} unset — deploy, then rerun to answer #1.`));
  }

  // ---------------------------------------------------------------- unknown #2
  console.log(fmt.head('#2 can ANY ERC-6909 holder redeem, or only the minter?'));
  const held = await pub.readContract({
    address: outcomeToken, abi: erc6909Abi, functionName: 'balanceOf',
    args: [account.address, ref.upId],
  }) as bigint;
  console.log(`wallet A holds ${held} of the UP leg`);
  console.log('Needs a RESOLVED market and two wallets:');
  console.log('  1. A mints a complete set        mintCompleteSet(op, venue, marketId, n)');
  console.log('  2. A transfers the UP leg to B   erc6909.transfer(B, upId, n)');
  console.log('  3. wait for the window to resolve');
  console.log(`  4. B calls                       redeem(${ref.operatorId}, venueId, marketId, 0, n)`);
  console.log('  -> B receives n collateral  => ANSWER #2 = YES, the duel design holds');
  console.log('  -> B reverts or receives 0  => ANSWER #2 = NO, ESCALATE (§9)');
  console.log(fmt.warn('There is also binarySettlement.redeem(outcomeId, amount, to) — check which path applies.'));

  console.log(fmt.head('Write the answers into docs/UNKNOWNS.md.'));
  market.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
