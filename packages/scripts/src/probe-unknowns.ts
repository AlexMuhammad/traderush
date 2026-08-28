/** §9 — the three blocking unknowns. Run this on DAY 1, against a 15-minute market,
 *  so answers arrive the same day. None can be answered from documentation.
 *
 *  #1 Can a contract call mintCompleteSet while holding user funds, or is it
 *     caller-funded only?              -> if NO, use the §4.4 swap fallback
 *  #2 Can ANY ERC-6909 holder redeem a winning leg, or only the original minter?
 *                                      -> if NO, the duel design collapses. Escalate.
 *  #3 How are upId / downId derived from marketId?
 *                                      -> if outcomeIds() is absent, read packages/core
 *
 *  Write the answers into docs/UNKNOWNS.md. That file is the M1 deliverable.
 */
import { createPublicClient, createWalletClient, http, encodeFunctionData, keccak256, encodePacked, type PublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { MarketAdapter, binaryMarketsModuleAbi, outcomeToken6909Abi, erc20Abi } from '@bullrun/sdk';
import { cfg, fmt, requireEnv } from './env.js';

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function main() {
  const account = privateKeyToAccount(requireEnv('PRIVATE_KEY_A') as `0x${string}`);
  const pub = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpcUrl) }) as PublicClient;
  const wallet = createWalletClient({ account, chain: cfg.chain, transport: http(cfg.rpcUrl) });

  const adapter = new MarketAdapter(cfg, { apiKey: process.env.DREAMDEX_API_KEY });
  const venue = await adapter.addresses();
  console.log(fmt.head('venue')); console.log(venue);

  const markets = await adapter.listMarkets();
  // A 15-minute market so a resolution lands the same day (§9).
  const target = markets
    .filter((m) => m.status === 'Trading')
    .sort((a, b) => Math.abs(a.intervalSec - 900) - Math.abs(b.intervalSec - 900))[0];
  if (!target) throw new Error('no Trading market to probe against — rerun when a window is open');
  console.log(fmt.head('probe market'));
  console.log(`${target.symbol} ${target.intervalSec}s  ${target.marketId}`);
  const marketId = target.marketId as `0x${string}`;

  // ---------------------------------------------------------------- unknown #3
  console.log(fmt.head('#3 how are upId / downId derived from marketId?'));
  let upId: bigint | null = null, downId: bigint | null = null;
  try {
    const ids = await pub.readContract({
      address: venue.module, abi: binaryMarketsModuleAbi, functionName: 'outcomeIds', args: [marketId],
    }) as readonly [bigint, bigint];
    [upId, downId] = [ids[0], ids[1]];
    console.log(fmt.ok(`outcomeIds() EXISTS -> up ${upId}  down ${downId}`));
  } catch (e) {
    console.log(fmt.bad(`outcomeIds() call failed: ${msg(e)}`));
    console.log(fmt.warn('Falling back to the keccak guesses; verify against dreamdex-bot-kit packages/core.'));
    const guesses: Record<string, bigint> = {
      'keccak(marketId, 1)': BigInt(keccak256(encodePacked(['bytes32', 'uint8'], [marketId, 1]))),
      'keccak(marketId, 0)': BigInt(keccak256(encodePacked(['bytes32', 'uint8'], [marketId, 0]))),
      'keccak(marketId, "UP")': BigInt(keccak256(encodePacked(['bytes32', 'string'], [marketId, 'UP']))),
      'keccak(marketId, "DOWN")': BigInt(keccak256(encodePacked(['bytes32', 'string'], [marketId, 'DOWN']))),
    };
    for (const [label, id] of Object.entries(guesses)) {
      console.log(`  ${label} = ${id}`);
    }
    console.log(fmt.warn('Mint one set manually, then check which id your balance lands on.'));
  }

  // ---------------------------------------------------------------- unknown #1
  console.log(fmt.head('#1 can a CONTRACT call mintCompleteSet with funds it holds?'));
  const amount = 10n ** 18n; // 1 USDso — the smallest useful probe
  const bal = await pub.readContract({
    address: venue.collateral, abi: erc20Abi, functionName: 'balanceOf', args: [account.address],
  });
  console.log(`wallet collateral balance: ${bal}`);
  if (bal < amount) {
    console.log(fmt.bad('not enough collateral to probe — fund the wallet from the faucet first'));
  } else {
    // (a) EOA path. If this fails, nothing downstream is meaningful.
    try {
      await pub.simulateContract({
        account, address: venue.module, abi: binaryMarketsModuleAbi,
        functionName: 'mintCompleteSet', args: [marketId, amount],
      });
      console.log(fmt.ok('EOA mintCompleteSet simulates cleanly'));
    } catch (e) {
      console.log(fmt.bad(`EOA mintCompleteSet reverts: ${msg(e)}`));
      console.log(fmt.warn('Check the collateral allowance to the module first.'));
    }
    // (b) Contract path. eth_call from the DEPLOYED escrow address is the real test:
    //     it answers "does the module care that msg.sender is a contract?".
    if (cfg.escrowAddress) {
      try {
        await pub.call({
          account: cfg.escrowAddress,
          to: venue.module,
          data: encodeFunctionData({
            abi: binaryMarketsModuleAbi, functionName: 'mintCompleteSet', args: [marketId, amount],
          }),
        });
        console.log(fmt.ok('ANSWER #1 = YES — a contract can mint. Keep the §4 design.'));
      } catch (e) {
        console.log(fmt.bad(`contract-sender mint reverts: ${msg(e)}`));
        console.log(fmt.warn('If this is an access-control revert and not just a missing balance/allowance, ANSWER #1 = NO -> §4.4 swap fallback.'));
      }
    } else {
      console.log(fmt.warn('DUEL_ESCROW_ADDRESS unset — deploy first, then rerun to answer #1 properly.'));
    }
  }

  // ---------------------------------------------------------------- unknown #2
  console.log(fmt.head('#2 can ANY ERC-6909 holder redeem, or only the original minter?'));
  console.log('This one needs a RESOLVED market and two wallets. Procedure:');
  console.log('  1. wallet A mints a complete set on a 15m market');
  console.log('  2. A transfers the UP leg to wallet B (ERC-6909 transfer)');
  console.log('  3. wait for the window to resolve');
  console.log('  4. B calls redeem(marketId, upId, n)');
  console.log('  -> B receives n USDso  => ANSWER #2 = YES, the duel design holds');
  console.log('  -> B reverts / receives 0 => ANSWER #2 = NO, ESCALATE IMMEDIATELY (§9)');
  if (upId !== null && cfg.escrowAddress) {
    const held = await pub.readContract({
      address: venue.outcomeToken, abi: outcomeToken6909Abi, functionName: 'balanceOf',
      args: [account.address, upId],
    });
    console.log(`wallet A currently holds ${held} of upId ${upId}`);
  }

  console.log(fmt.head('Write these answers into docs/UNKNOWNS.md before writing contract logic.'));
  adapter.close();
  void wallet;
}

main().catch((e) => { console.error(e); process.exit(1); });
