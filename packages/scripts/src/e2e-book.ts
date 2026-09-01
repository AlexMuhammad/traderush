/**
 * `pnpm e2e:book` — the front page's journey, on testnet, in one run.
 *
 * The other two cover the escrows: `e2e` walks a duel, `e2e:room` walks a room.
 * The screen most people will actually touch walks neither — it buys the event
 * contract on the book — and until now the only thing exercising that path was a
 * probe that placed one order and stopped. A probe says the order landed. It
 * does not say the winner gets paid.
 *
 * So this waits for a real window to close and checks the thing that matters:
 * one contract redeems for one collateral if it won, and for nothing if it lost
 * — WITHOUT reverting, because a losing redeem that reverts strands the loser's
 * screen on an error forever.
 *
 * It takes the length of one short window.
 *
 *   pnpm e2e:book
 */
import { createPublicClient, createWalletClient, http, formatUnits, type PublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  MarketAdapter, makeOrderSubmitter, binarySettlementAbi, erc6909Abi, txUrl,
} from '@traderush/sdk';
import { cfg, fmt, requireEnv } from './env.js';

let checks = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = ''): boolean {
  checks++;
  if (!ok) failed++;
  console.log(ok ? fmt.ok(`${label}${detail ? `  (${detail})` : ''}`)
                 : fmt.bad(`${label}${detail ? `  (${detail})` : ''}`));
  return ok;
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);

const A = privateKeyToAccount(requireEnv('PRIVATE_KEY_A') as `0x${string}`);
const pub = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpcUrl) }) as PublicClient;
const wallet = createWalletClient({ account: A, chain: cfg.chain, transport: http(cfg.rpcUrl) });
const market = new MarketAdapter(cfg, { publicClient: pub });
market.setOrderSubmitter(makeOrderSubmitter({
  cfg, discovery: market.discovery, wallet, account: A, publicClient: pub,
}));

const scale = 10n ** BigInt(cfg.decimals);
const unit = (v: bigint) => `${formatUnits(v, cfg.decimals)} ${cfg.collateralSymbol}`;

console.log(fmt.head(`TRADE RUSH book · ${cfg.network} · chain ${cfg.chainId}`));

// --- 1. a window worth trading -------------------------------------------
// Long enough to still be open after the buy confirms, short enough that this
// finishes: the book is the point, not the wait.
const live = (await market.listMarkets())
  .filter((m) => m.status === 'Trading')
  .filter((m) => m.expiryTime - now() > 60 && m.expiryTime - now() < 900)
  .sort((a, b) => (a.expiryTime - now()) - (b.expiryTime - now()));

const target = live.find((m) => m.upLiquid || m.downLiquid);
if (!check('a tradeable window with a book', Boolean(target))) { market.close(); process.exit(1); }
const m = target!;
console.log(`   ${m.symbol} ${m.intervalSec}s · strike ${m.strike} · ${m.expiryTime - now()}s left`);

// --- 2. buy the side the book is actually offering ------------------------
console.log(fmt.head('buy'));
const balanceBefore = await market.balance(A.address);
const side = m.upLiquid ? 'up' : 'down';
const stake = 1n * scale;
if (!check('the wallet can cover the stake', balanceBefore >= stake, unit(balanceBefore))) {
  market.close(); process.exit(1);
}

// The pool escrows the collateral, so it needs an allowance like any spender.
const pos = await market.buy(m.marketId as `0x${string}`, side, stake);
check('the order filled', pos.size > 0n, `${pos.size} contracts`);
console.log(`   ${txUrl(cfg, pos.txHash)}`);

const ref = (await market.discovery.get(m.marketId))!.ref;
const token = await pub.readContract({
  address: cfg.addresses.binarySettlement, abi: binarySettlementAbi, functionName: 'outcomeToken',
}) as `0x${string}`;
const heldOf = (id: bigint) => pub.readContract({
  address: token, abi: erc6909Abi, functionName: 'balanceOf', args: [A.address, id],
}) as Promise<bigint>;

const myId = side === 'up' ? ref.upId : ref.downId;
const held = await heldOf(myId);
check('the contracts are in the wallet', held >= pos.size, `${held}`);
check('the collateral left the wallet', (await market.balance(A.address)) < balanceBefore);

// --- 3. wait for the window, then redeem ---------------------------------
console.log(fmt.head('settlement'));
console.log(`   waiting ${m.expiryTime - now() + 20}s for the window to close`);
await wait(Math.max(0, m.expiryTime - now() + 20) * 1000);

const settled = await market.discovery.get(m.marketId);
if (!check('the oracle posted a result', settled?.status === 'Resolved' || settled?.status === 'Voided',
           String(settled?.status))) {
  market.close(); process.exit(1);
}

const upWon = settled!.spot > settled!.strike;
const iWon = settled!.status === 'Voided' ? null : (side === 'up') === upWon;
console.log(`   closed at ${settled!.spot} against ${settled!.strike} — ${upWon ? 'UP' : 'DOWN'} took it`);

const beforeRedeem = await market.balance(A.address);
const { request } = await pub.simulateContract({
  account: A, address: cfg.addresses.binarySettlement,
  abi: binarySettlementAbi, functionName: 'redeem',
  args: [myId, held, A.address],
});
const tx = await wallet.writeContract(request);
await pub.waitForTransactionReceipt({ hash: tx });
console.log(`   ${txUrl(cfg, tx)}`);

const got = (await market.balance(A.address)) - beforeRedeem;
check('the losing leg redeems without reverting', true);
check('the contracts are gone from the wallet', (await heldOf(myId)) === 0n);

if (iWon === null) {
  check('a void returns something', got > 0n, unit(got));
} else if (iWon) {
  // One contract pays exactly one collateral. This is the whole promise.
  check('every winning contract paid one collateral', got === held, `${unit(got)} for ${held}`);
  check('the win beat the stake', got > stake, `${unit(got)} on ${unit(stake)}`);
} else {
  check('a losing leg pays nothing', got === 0n, unit(got));
}

console.log(fmt.head(failed ? `FAILED — ${failed} of ${checks}` : `PASS — ${checks} checks`));
market.close();
process.exit(failed ? 1 : 0);
