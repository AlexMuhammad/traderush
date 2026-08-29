/**
 * `pnpm e2e` — the whole journey on testnet, in one run.
 *
 * This walks the same code the browser walks: the discovery the console's dials
 * read, the allowance check the create screen shows, the deadline bounds it
 * enforces, the blocker list the accept screen renders, and the settlement path
 * the payout screen calls. What it cannot cover is React rendering and Privy's
 * login UI — everything below the wallet client is exercised for real, with real
 * transactions, against live markets.
 *
 * It waits for a window to close, so give it the length of one short market.
 *
 *   pnpm e2e
 */
import { createPublicClient, createWalletClient, http, formatUnits, type PublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  DuelAdapter, MarketAdapter, parseDuelLink, txUrl,
  binarySettlementAbi, erc6909Abi,
  MIN_DEADLINE_MARGIN_SEC, defaultAcceptDeadline,
} from '@bullrun/sdk';
import { cfg, fmt, requireEnv } from './env.js';

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

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

async function main() {
  const A = privateKeyToAccount(requireEnv('PRIVATE_KEY_A') as `0x${string}`);
  const B = privateKeyToAccount(requireEnv('PRIVATE_KEY_B') as `0x${string}`);

  console.log(fmt.head(`BULLRUN e2e · ${cfg.network} · chain ${cfg.chainId}`));

  // --- 1. what a fresh page load resolves ----------------------------------
  check('escrow is configured', Boolean(cfg.escrowAddress), cfg.escrowAddress ?? 'unset');
  check('privy app id is configured', Boolean(cfg.privyAppId), cfg.privyAppId ? 'set' : 'unset');
  check('the two wallets differ', A.address !== B.address);
  if (failed) { console.log(fmt.bad('\nconfiguration is incomplete; stopping')); process.exit(1); }

  const pub = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpcUrl) }) as PublicClient;
  const walletA = createWalletClient({ account: A, chain: cfg.chain, transport: http(cfg.rpcUrl) });
  const walletB = createWalletClient({ account: B, chain: cfg.chain, transport: http(cfg.rpcUrl) });
  const market = new MarketAdapter(cfg, { publicClient: pub });
  const duels = new DuelAdapter(cfg, undefined, { publicClient: pub });

  const decimals = await market.collateralDecimals();
  const unit = (v: bigint) => `${formatUnits(v, decimals)} ${cfg.collateralSymbol}`;

  // --- 2. discovery, as the dials and the market screen read it ------------
  console.log(fmt.head('markets'));
  const now = () => Math.floor(Date.now() / 1000);
  const live = (await market.listMarkets()).filter((m) => m.status === 'Trading');
  check('live markets found', live.length > 0, `${live.length}`);
  check('both assets present', new Set(live.map((m) => m.symbol)).size >= 2,
        [...new Set(live.map((m) => m.symbol))].join('/'));
  check('every market has outcome ids', live.every((m) => m.ref.upId > 0n && m.ref.downId > 0n));
  check('every market has a strike', live.every((m) => m.strike > 0));

  // The create screen's own rule: a window must hold the accept margin plus
  // time for someone to actually accept. Shortest such market, so the run ends.
  const roomy = live
    .filter((m) => m.expiryTime - now() > MIN_DEADLINE_MARGIN_SEC + 90)
    .sort((a, b) => (a.expiryTime - now()) - (b.expiryTime - now()));
  const target = roomy[0];
  if (!check('a market has room for a duel', Boolean(target))) { market.close(); process.exit(1); }
  const m = target!;
  const secondsLeft = m.expiryTime - now();
  console.log(`   ${m.symbol} ${m.intervalSec}s · strike ${m.strike} · spot ${m.spot} · ${secondsLeft}s left`);

  // --- 3. balances and the allowance the create screen surfaces ------------
  console.log(fmt.head('wallets'));
  const stake = 10n ** BigInt(decimals);            // 1 unit per side
  const pot = stake * 2n;
  for (const [name, acct, wallet] of [['A', A, walletA], ['B', B, walletB]] as const) {
    const balance = await market.balance(acct.address);
    if (!check(`${name} can cover the stake`, balance >= stake, unit(balance))) {
      console.log(fmt.warn('   run `pnpm faucet`'));
      market.close(); process.exit(1);
    }
    const allowance = await duels.allowance(cfg.addresses.collateral, acct.address);
    if (allowance < stake) {
      const { txHash } = await duels.approve(wallet, acct, cfg.addresses.collateral, stake * 1000n);
      check(`${name} approved the escrow`, true, txHash.slice(0, 12));
    } else {
      check(`${name} already approved the escrow`, true);
    }
  }

  // --- 4. open, as the create screen does ----------------------------------
  console.log(fmt.head('open'));
  // Bounded by the window, exactly as CreateDuelPanel bounds it.
  const maxMargin = Math.max(0, m.expiryTime - now() - 10);
  const margin = Math.min(60, maxMargin);
  check('the deadline clears the margin', margin >= MIN_DEADLINE_MARGIN_SEC, `${margin}s`);
  const acceptDeadline = m.expiryTime - margin;
  void defaultAcceptDeadline;

  const opened = await duels.open(
    walletA, A, m.marketId as `0x${string}`, 'up', stake, acceptDeadline, m.expiryTime,
  );
  check('open produced a duel id', opened.duelId > 0n, `#${opened.duelId}`);
  console.log(`   ${txUrl(cfg, opened.txHash)}`);

  // --- 5. the link, as the accept screen parses it -------------------------
  const link = parseDuelLink(opened.link);
  check('the link parses', Boolean(link), opened.link);
  check('the link names this chain', link?.chainId === cfg.chainId);
  check('the link names this escrow', link?.escrow.toLowerCase() === duels.escrow.toLowerCase());

  const beforeAccept = await duels.read(opened.duelId);
  check('the duel reads back as Open', beforeAccept?.status === 'Open', String(beforeAccept?.status));
  check('the pot is twice the stake', beforeAccept?.pot === pot, unit(beforeAccept?.pot ?? 0n));

  // --- 6. the accept screen's blockers, then accept ------------------------
  console.log(fmt.head('accept'));
  const bBalance = await market.balance(B.address);
  const blockers = [
    beforeAccept?.status !== 'Open' && 'not open',
    now() >= (beforeAccept?.acceptDeadline ?? 0) && 'deadline passed',
    B.address.toLowerCase() === beforeAccept?.challenger.toLowerCase() && 'self duel',
    bBalance < stake && 'insufficient balance',
  ].filter(Boolean);
  check('B has no blockers', blockers.length === 0, blockers.join(', '));

  const accepted = await duels.accept(walletB, B, opened.duelId);
  console.log(`   ${txUrl(cfg, accepted.txHash)}`);

  const matched = await duels.read(opened.duelId);
  check('the duel is Matched', matched?.status === 'Matched', String(matched?.status));
  check('the opponent is B', matched?.opponent.toLowerCase() === B.address.toLowerCase());

  // --- 7. the invariants the whole design rests on -------------------------
  const outcomeToken = await pub.readContract({
    address: cfg.addresses.binarySettlement, abi: binarySettlementAbi, functionName: 'outcomeToken',
  }) as `0x${string}`;
  const legOf = (who: `0x${string}`, id: bigint) => pub.readContract({
    address: outcomeToken, abi: erc6909Abi, functionName: 'balanceOf', args: [who, id],
  }) as Promise<bigint>;

  check('A holds the whole pot in UP', (await legOf(A.address, m.ref.upId)) >= pot);
  check('B holds the whole pot in DOWN', (await legOf(B.address, m.ref.downId)) >= pot);
  check('the escrow kept nothing', (await market.balance(duels.escrow)) === 0n);

  // --- 8. My duels, as that screen builds it -------------------------------
  const mineA = await duels.listFor(A.address);
  const mineB = await duels.listFor(B.address);
  check("the duel shows in A's list", mineA.some((d) => d.id === opened.duelId));
  check("the duel shows in B's list", mineB.some((d) => d.id === opened.duelId));

  // --- 9. wait it out, then settle as the payout screen does ---------------
  console.log(fmt.head('settlement'));
  const closesIn = m.expiryTime - now();
  console.log(`   window closes in ${closesIn}s, then the oracle posts`);
  await wait(Math.max(0, closesIn + 20) * 1000);

  let row = null;
  for (let i = 0; i < 20 && !row; i++) {
    const fresh = await market.discovery.client.getBinaryMarket(m.marketId);
    if (fresh && (fresh.winningOutcome !== null || fresh.voided)) row = fresh;
    else await wait(6_000);
  }
  if (!check('the oracle posted a result', Boolean(row))) { market.close(); process.exit(1); }

  const settledMarket = await market.discovery.get(m.marketId);
  check('a settled market is still readable by id', Boolean(settledMarket),
        settledMarket ? settledMarket.status : 'missing');

  const voided = Boolean(row!.voided);
  const winningIdx = (row!.winningOutcome ?? 0) as 0 | 1;
  console.log(`   ${voided ? 'VOIDED' : `${winningIdx === 0 ? 'UP' : 'DOWN'} took it`}`);

  const claim = async (who: typeof A, wallet: typeof walletA, idx: 0 | 1) => {
    const id = idx === 0 ? m.ref.upId : m.ref.downId;
    const held = await legOf(who.address, id);
    if (held === 0n) return 0n;
    const before = await market.balance(who.address);
    const { request } = await pub.simulateContract({
      account: who, address: cfg.addresses.binarySettlement,
      abi: binarySettlementAbi, functionName: 'redeem', args: [id, held, who.address],
    });
    const hash = await wallet.writeContract(request);
    await pub.waitForTransactionReceipt({ hash });
    return (await market.balance(who.address)) - before;
  };

  const aGot = await claim(A, walletA, 0);
  const bGot = await claim(B, walletB, 1);

  if (voided) {
    check('a void refunds both sides', aGot === stake && bGot === stake, `${unit(aGot)} / ${unit(bGot)}`);
  } else {
    const winnerGot = winningIdx === 0 ? aGot : bGot;
    const loserGot = winningIdx === 0 ? bGot : aGot;
    check('the winner takes the whole pot', winnerGot === pot, unit(winnerGot));
    check('the loser gets nothing, without reverting', loserGot === 0n, unit(loserGot));
  }

  // --- 10. the unmatched path ----------------------------------------------
  console.log(fmt.head('unmatched refund'));
  const stillLive = (await market.listMarkets())
    .filter((x) => x.status === 'Trading' && x.expiryTime - now() > MIN_DEADLINE_MARGIN_SEC + 60)
    .sort((a, b) => (a.expiryTime - now()) - (b.expiryTime - now()))[0];
  if (stillLive) {
    const before = await market.balance(A.address);
    const orphan = await duels.open(
      walletA, A, stillLive.marketId as `0x${string}`, 'down', stake,
      stillLive.expiryTime - Math.min(60, stillLive.expiryTime - now() - 10), stillLive.expiryTime,
    );
    await duels.cancel(walletA, A, orphan.duelId);
    check('an unmatched duel refunds exactly', (await market.balance(A.address)) === before);
    check('the cancelled duel reads back Cancelled',
          (await duels.read(orphan.duelId))?.status === 'Cancelled');
  } else {
    console.log(fmt.warn('   no market with room; skipped'));
  }

  console.log(fmt.head(failed ? `FAILED — ${failed} of ${checks}` : `PASS — ${checks} checks`));
  market.close();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(msg(e)); process.exit(1); });
