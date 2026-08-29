/**
 * `pnpm e2e:room` — a whole room on testnet, in one run.
 *
 * Three players, two sides, UNEQUAL stakes, so the parimutuel split is actually
 * exercised rather than collapsing into the duel's even-money case. It waits for
 * a window to close, so give it the length of one short market.
 */
import { createPublicClient, createWalletClient, http, formatUnits, type PublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  RoomAdapter, MarketAdapter, parseRoomLink, txUrl,
  binarySettlementAbi, erc6909Abi, MIN_DEADLINE_MARGIN_SEC,
} from '@bullrun/sdk';
import { cfg, fmt, requireEnv } from './env.js';

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
let checks = 0, failed = 0;
function check(label: string, ok: boolean, detail = ''): boolean {
  checks++; if (!ok) failed++;
  console.log(ok ? fmt.ok(`${label}${detail ? `  (${detail})` : ''}`)
                 : fmt.bad(`${label}${detail ? `  (${detail})` : ''}`));
  return ok;
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const A = privateKeyToAccount(requireEnv('PRIVATE_KEY_A') as `0x${string}`);
  const B = privateKeyToAccount(requireEnv('PRIVATE_KEY_B') as `0x${string}`);

  console.log(fmt.head(`BULLRUN rooms · ${cfg.network} · chain ${cfg.chainId}`));
  if (!check('room escrow is configured', Boolean(cfg.roomEscrowAddress), cfg.roomEscrowAddress ?? 'unset')) {
    process.exit(1);
  }

  const pub = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpcUrl) }) as PublicClient;
  const walletA = createWalletClient({ account: A, chain: cfg.chain, transport: http(cfg.rpcUrl) });
  const walletB = createWalletClient({ account: B, chain: cfg.chain, transport: http(cfg.rpcUrl) });
  const market = new MarketAdapter(cfg, { publicClient: pub });
  const rooms = new RoomAdapter(cfg, undefined, { publicClient: pub });

  const decimals = await market.collateralDecimals();
  const unit = (v: bigint) => `${formatUnits(v, decimals)} ${cfg.collateralSymbol}`;
  const ONE = 10n ** BigInt(decimals);

  const now = () => Math.floor(Date.now() / 1000);
  // Captured BEFORE any staking, so the net result is measurable at the end.
  const opening = { a: await market.balance(A.address), b: await market.balance(B.address) };
  const live = (await market.listMarkets()).filter((m) => m.status === 'Trading');
  const target = live
    .filter((m) => m.expiryTime - now() > MIN_DEADLINE_MARGIN_SEC + 90)
    .sort((a, b) => (a.expiryTime - now()) - (b.expiryTime - now()))[0];
  if (!check('a market has room for a window', Boolean(target))) { market.close(); process.exit(1); }
  const m = target!;
  console.log(`   ${m.symbol} ${m.intervalSec}s · strike ${m.strike} · ${m.expiryTime - now()}s left`);

  // Approvals.
  for (const [name, acct, wallet] of [['A', A, walletA], ['B', B, walletB]] as const) {
    const allowance = await rooms.allowance(acct.address);
    if (allowance < 10n * ONE) {
      await rooms.approve(wallet, acct, 1000n * ONE);
      check(`${name} approved the room escrow`, true);
    } else check(`${name} already approved`, true);
  }

  // --- open with UNEQUAL sides so the split is real ------------------------
  console.log(fmt.head('open and join'));
  const margin = Math.min(60, Math.max(MIN_DEADLINE_MARGIN_SEC, m.expiryTime - now() - 40));
  const entryDeadline = m.expiryTime - margin;

  // A takes UP twice (2 + 1 = 3), B takes DOWN once (1). Pot 4, UP pays 1.33x,
  // DOWN pays 4x — nothing like the duel's flat 2x.
  const opened = await rooms.open(walletA, A, m.marketId as `0x${string}`, 'up', 2n * ONE, entryDeadline, m.expiryTime);
  check('open produced a room id', opened.roomId > 0n, `#${opened.roomId}`);
  console.log(`   ${txUrl(cfg, opened.txHash)}`);

  await rooms.join(walletA, A, opened.roomId, 'up', 1n * ONE);
  await rooms.join(walletB, B, opened.roomId, 'down', 1n * ONE);

  const link = parseRoomLink(opened.link);
  check('the link parses and names this escrow',
        link?.escrow.toLowerCase() === rooms.escrow.toLowerCase(), opened.link);

  const room = await rooms.read(opened.roomId);
  check('both sides are recorded', room?.totalUp === 3n * ONE && room?.totalDown === 1n * ONE,
        `${unit(room?.totalUp ?? 0n)} up / ${unit(room?.totalDown ?? 0n)} down`);
  check('the pot is everything staked', room?.pot === 4n * ONE, unit(room?.pot ?? 0n));
  check('the room is contested', room?.oneSided === false);

  const seatA = await rooms.seat(opened.roomId, A.address);
  const seatB = await rooms.seat(opened.roomId, B.address);
  // A holds the whole UP leg (3/3 of it), B the whole DOWN leg.
  check('A is quoted the whole UP leg', seatA.shareUp === 4n * ONE, unit(seatA.shareUp));
  check('B is quoted the whole DOWN leg', seatB.shareDown === 4n * ONE, unit(seatB.shareDown));

  // --- entry closes, then claim -------------------------------------------
  console.log(fmt.head('claim'));
  const closesIn = entryDeadline - now();
  console.log(`   entry closes in ${closesIn}s`);
  await wait(Math.max(0, closesIn + 5) * 1000);

  await rooms.claim(walletA, A, opened.roomId);
  await rooms.claim(walletB, B, opened.roomId);

  const outcomeToken = await pub.readContract({
    address: cfg.addresses.binarySettlement, abi: binarySettlementAbi, functionName: 'outcomeToken',
  }) as `0x${string}`;
  const legOf = (who: `0x${string}`, id: bigint) => pub.readContract({
    address: outcomeToken, abi: erc6909Abi, functionName: 'balanceOf', args: [who, id],
  }) as Promise<bigint>;

  check('A holds the whole UP leg', (await legOf(A.address, m.ref.upId)) >= 4n * ONE);
  check('B holds the whole DOWN leg', (await legOf(B.address, m.ref.downId)) >= 4n * ONE);
  check('the escrow kept no collateral', (await market.balance(rooms.escrow)) === 0n);

  const mine = await rooms.listFor(A.address);
  check('the room shows in A’s list', mine.some((r) => r.room.id === opened.roomId));

  // --- settle --------------------------------------------------------------
  console.log(fmt.head('settlement'));
  await wait(Math.max(0, m.expiryTime - now() + 20) * 1000);
  let row = null;
  for (let i = 0; i < 20 && !row; i++) {
    const fresh = await market.discovery.client.getBinaryMarket(m.marketId);
    if (fresh && (fresh.winningOutcome !== null || fresh.voided)) row = fresh;
    else await wait(6_000);
  }
  if (!check('the oracle posted a result', Boolean(row))) { market.close(); process.exit(1); }
  const voided = Boolean(row!.voided);
  const upWon = (row!.winningOutcome ?? 0) === 0;
  console.log(`   ${voided ? 'VOIDED' : `${upWon ? 'UP' : 'DOWN'} took it`}`);

  const redeem = async (who: typeof A, wallet: typeof walletA, id: bigint) => {
    const held = await legOf(who.address, id);
    if (held === 0n) return 0n;
    const start = await market.balance(who.address);
    const { request } = await pub.simulateContract({
      account: who, address: cfg.addresses.binarySettlement,
      abi: binarySettlementAbi, functionName: 'redeem', args: [id, held, who.address],
    });
    const hash = await wallet.writeContract(request);
    await pub.waitForTransactionReceipt({ hash });
    return (await market.balance(who.address)) - start;
  };

  const gotA = await redeem(A, walletA, m.ref.upId);
  const gotB = await redeem(B, walletB, m.ref.downId);

  if (voided) {
    check('a void pays both sides half', gotA === 2n * ONE && gotB === 2n * ONE, `${unit(gotA)} / ${unit(gotB)}`);
  } else if (upWon) {
    // A staked 3 into a pot of 4 and was the whole UP side: 4 back, 1.33x.
    check('the winning side takes the whole pot', gotA === 4n * ONE, unit(gotA));
    check('the losing side gets nothing, without reverting', gotB === 0n, unit(gotB));
    // A staked 3 of a 4 pot: 1.33x, so net +1 — exactly what B lost.
    const netA = (await market.balance(A.address)) - opening.a;
    const netB = (await market.balance(B.address)) - opening.b;
    check('A nets the losers’ stake', netA === 1n * ONE, unit(netA));
    check('B is out exactly their stake', netB === -1n * ONE, unit(netB));
  } else {
    // B staked 1 of a 4 pot: 4x, so net +3 — exactly what A lost.
    check('the winning side takes the whole pot', gotB === 4n * ONE, unit(gotB));
    check('the losing side gets nothing, without reverting', gotA === 0n, unit(gotA));
    const netA = (await market.balance(A.address)) - opening.a;
    const netB = (await market.balance(B.address)) - opening.b;
    check('B turns 1 into 4 — a 4x the duel could never pay', netB === 3n * ONE, unit(netB));
    check('A is out exactly their stake', netA === -3n * ONE, unit(netA));
  }

  console.log(fmt.head(failed ? `FAILED — ${failed} of ${checks}` : `PASS — ${checks} checks`));
  market.close();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(msg(e)); process.exit(1); });
