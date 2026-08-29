/** `pnpm settle` — settles the duel and answers §9 unknown #2.
 *
 *  The question is whether ANY ERC-6909 holder can redeem a winning leg, or only
 *  whoever minted it. The M3 duel sets that up exactly: the ESCROW minted the
 *  complete set and transferred the legs out, so neither wallet holding a leg is
 *  the minter. If the winner can redeem, the duel design holds. If not, it
 *  collapses and there is no working around it.
 *
 *  Winnings are CLAIMED, not received — nothing pays out until someone asks.
 */
import { createPublicClient, createWalletClient, http, formatUnits, type PublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  DuelAdapter, MarketAdapter, binarySettlementAbi, erc6909Abi, txUrl,
} from '@traderush/sdk';
import { cfg, fmt, requireEnv } from './env.js';

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function main() {
  const duelId = BigInt(process.env.DUEL_ID ?? '1');
  const A = privateKeyToAccount(requireEnv('PRIVATE_KEY_A') as `0x${string}`);
  const B = privateKeyToAccount(requireEnv('PRIVATE_KEY_B') as `0x${string}`);

  const pub = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpcUrl) }) as PublicClient;
  const market = new MarketAdapter(cfg, { publicClient: pub });
  const duels = new DuelAdapter(cfg, undefined, { publicClient: pub });

  const duel = await duels.read(duelId);
  if (!duel) throw new Error(`duel #${duelId} does not exist at ${duels.escrow}`);
  if (duel.status !== 'Matched') throw new Error(`duel #${duelId} is ${duel.status}, not Matched`);

  console.log(fmt.head(`duel #${duelId}`));
  console.log(`challenger ${duel.challenger} · ${duel.challengerUp ? 'UP' : 'DOWN'}`);
  console.log(`opponent   ${duel.opponent} · ${duel.challengerUp ? 'DOWN' : 'UP'}`);

  const summary = await market.discovery.get(duel.marketId);
  if (!summary) throw new Error(`market ${duel.marketId} is not in the indexer`);
  const ref = summary.ref;
  const unit = (v: bigint) => `${formatUnits(v, ref.decimals)} ${cfg.collateralSymbol}`;
  console.log(`market     ${summary.symbol} ${summary.intervalSec}s · ${summary.status}`);
  console.log(`pot        ${unit(duel.pot)}`);

  // --- has it settled? -------------------------------------------------------
  const row = await market.discovery.client.getBinaryMarket(duel.marketId);
  const now = Math.floor(Date.now() / 1000);
  if (summary.expiryTime > now) {
    console.log(fmt.warn(`window closes in ${summary.expiryTime - now}s — nothing to settle yet`));
    market.close();
    return;
  }
  if (row?.winningOutcome === null && !row?.voided) {
    console.log(fmt.warn('window closed but the oracle has not posted yet — rerun shortly'));
    market.close();
    return;
  }

  const voided = Boolean(row?.voided);
  // 0 = YES/UP wins, 1 = NO/DOWN wins.
  const winningIdx = (row?.winningOutcome ?? 0) as 0 | 1;
  console.log(fmt.head('settlement'));
  console.log(voided ? 'VOIDED — both sides redeem 0.5, this is not a loss (§8.10)'
                     : `${winningIdx === 0 ? 'UP' : 'DOWN'} took it`);

  const challengerWon = duel.challengerUp === (winningIdx === 0);
  const winner = challengerWon ? A : B;
  const loser = challengerWon ? B : A;
  const winnerIdx: 0 | 1 = challengerWon ? (duel.challengerUp ? 0 : 1) : (duel.challengerUp ? 1 : 0);
  const loserIdx: 0 | 1 = winnerIdx === 0 ? 1 : 0;

  const outcomeToken = await pub.readContract({
    address: cfg.addresses.binarySettlement, abi: binarySettlementAbi, functionName: 'outcomeToken',
  }) as `0x${string}`;

  const redeem = async (who: typeof A, idx: 0 | 1, label: string) => {
    const id = idx === 0 ? ref.upId : ref.downId;
    const held = await pub.readContract({
      address: outcomeToken, abi: erc6909Abi, functionName: 'balanceOf', args: [who.address, id],
    }) as bigint;
    const before = await market.balance(who.address);
    console.log(`\n${label} ${who.address}`);
    console.log(`  holds ${held} of ${idx === 0 ? 'UP' : 'DOWN'} (minted by the escrow, not by them)`);
    if (held === 0n) { console.log(fmt.warn('  nothing to redeem')); return; }

    const wallet = createWalletClient({ account: who, chain: cfg.chain, transport: http(cfg.rpcUrl) });
    try {
      // BinarySettlement, not the module. The module's redeem reverts once the
      // market is finalized and its pool released; the settlement contract holds
      // the backing and pays against the outcome id itself — which is precisely
      // the "any holder" primitive the duel depends on. See docs/FINDINGS.md.
      const { request } = await pub.simulateContract({
        account: who, address: cfg.addresses.binarySettlement, abi: binarySettlementAbi,
        functionName: 'redeem', args: [id, held, who.address],
      });
      const hash = await wallet.writeContract(request);
      await pub.waitForTransactionReceipt({ hash });
      const gained = (await market.balance(who.address)) - before;
      console.log(fmt.ok(`  redeemed → +${unit(gained)}   ${txUrl(cfg, hash)}`));
      return gained;
    } catch (e) {
      console.log(fmt.bad(`  redeem reverted: ${msg(e)}`));
      return null;
    }
  };

  const won = await redeem(winner, winnerIdx, 'WINNER  ');
  // §11 — the loser's leg must redeem 0 WITHOUT reverting.
  const lost = await redeem(loser, loserIdx, 'LOSER   ');

  console.log(fmt.head('§9 unknown #2'));
  if (won !== null && won !== undefined && won > 0n) {
    console.log(fmt.ok('ANSWER = YES. A holder who did not mint the leg redeemed it.'));
    console.log(fmt.ok('The duel design holds.'));
    if (!voided && won < duel.pot) {
      console.log(fmt.warn(`paid ${unit(won)} against a pot of ${unit(duel.pot)} — check the arithmetic`));
    }
  } else {
    console.log(fmt.bad('ANSWER = NO, or blocked. The winner could not redeem a leg it did not mint.'));
    console.log(fmt.bad('ESCALATE — the duel design depends on this (§9).'));
  }
  console.log(lost === 0n ? fmt.ok('loser redeemed 0 without reverting (§11)')
                          : fmt.warn(`loser path: ${lost === null ? 'REVERTED — §11 violated' : unit(lost ?? 0n)}`));

  market.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
