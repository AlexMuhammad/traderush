/** M3 — the real gate. Two wallets complete a duel with NO UI. Tx hashes are recorded.
 *  If this is not green by day 3, stop and re-scope (§10).
 *
 *  Usage: PRIVATE_KEY_A=0x.. PRIVATE_KEY_B=0x.. DUEL_ESCROW_ADDRESS=0x.. pnpm e2e
 */
import { createPublicClient, createWalletClient, http, formatUnits, type PublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  DuelAdapter, MarketAdapter, txUrl,
  defaultAcceptDeadline, assertDeadlineSafe, MIN_DEADLINE_MARGIN_SEC,
  outcomeToken6909Abi, binaryMarketsModuleAbi,
} from '@bullrun/sdk';
import { cfg, fmt, requireEnv } from './env.js';

const record: { step: string; txHash: string; url: string }[] = [];
const note = (step: string, txHash: string) => {
  record.push({ step, txHash, url: txUrl(cfg, txHash) });
  console.log(fmt.ok(`${step}  ${txHash}`));
};

async function main() {
  const A = privateKeyToAccount(requireEnv('PRIVATE_KEY_A') as `0x${string}`);
  const B = privateKeyToAccount(requireEnv('PRIVATE_KEY_B') as `0x${string}`);
  if (A.address.toLowerCase() === B.address.toLowerCase()) {
    throw new Error('PRIVATE_KEY_A and PRIVATE_KEY_B are the same wallet — accept() reverts SelfDuel');
  }

  const pub = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpcUrl) }) as PublicClient;
  const walletA = createWalletClient({ account: A, chain: cfg.chain, transport: http(cfg.rpcUrl) });
  const walletB = createWalletClient({ account: B, chain: cfg.chain, transport: http(cfg.rpcUrl) });

  const market = new MarketAdapter(cfg, { apiKey: process.env.DREAMDEX_API_KEY, publicClient: pub });
  const duels = new DuelAdapter(cfg, undefined, { publicClient: pub });
  const venue = await market.addresses();
  const decimals = await market.collateralDecimals();
  const unit = (v: bigint) => `${formatUnits(v, decimals)} USDso`;

  console.log(fmt.head('wallets'));
  console.log(`A ${A.address}  ${unit(await market.balance(A.address))}`);
  console.log(`B ${B.address}  ${unit(await market.balance(B.address))}`);

  // --- pick a Trading market with enough runway for the whole flow -----------
  const now = () => Math.floor(Date.now() / 1000);
  const all = await market.listMarkets();
  const target = all.find((m) => m.status === 'Trading' && m.expiryTime - now() > MIN_DEADLINE_MARGIN_SEC + 120);
  if (!target) throw new Error('no Trading market with enough runway — rerun when a window has just opened');
  const marketId = target.marketId as `0x${string}`;
  console.log(fmt.head('market'));
  console.log(`${target.symbol} ${target.intervalSec}s  strike ${target.strike}  spot ${target.spot}`);
  console.log(`${marketId}  expires in ${target.expiryTime - now()}s`);

  const stake = BigInt(10) ** BigInt(decimals); // 1 USDso per side -> pot of 2
  const pot = stake * 2n;
  console.log(`stake ${unit(stake)} per side, pot ${unit(pot)}, escrow mints ${unit(pot)} of sets`);

  // --- approvals (once per wallet) ------------------------------------------
  for (const [label, w, acct] of [['A', walletA, A], ['B', walletB, B]] as const) {
    const allowance = await duels.allowance(venue.collateral, acct.address);
    if (allowance < stake) {
      const { txHash } = await duels.approve(w, acct, venue.collateral, stake * 100n);
      note(`approve ${label}`, txHash);
    } else {
      console.log(fmt.ok(`approve ${label}  (already approved)`));
    }
  }

  // --- A opens ---------------------------------------------------------------
  // §8.11 — acceptDeadline must be >= 30s before expiry. Default is expiry - 60s.
  const acceptDeadline = defaultAcceptDeadline(target.expiryTime);
  assertDeadlineSafe(acceptDeadline, target.expiryTime);
  const opened = await duels.open(walletA, A, marketId, 'up', stake, acceptDeadline, target.expiryTime);
  note(`open (A, up, deadline ${acceptDeadline})`, opened.txHash);
  console.log(`duelId ${opened.duelId}   link ${opened.link}`);

  const afterOpen = await duels.read(opened.duelId);
  if (afterOpen?.status !== 'Open') throw new Error(`expected Open, got ${afterOpen?.status}`);

  // --- B accepts -------------------------------------------------------------
  const accepted = await duels.accept(walletB, B, opened.duelId);
  note('accept (B, down)', accepted.txHash);

  const matched = await duels.read(opened.duelId);
  if (matched?.status !== 'Matched') throw new Error(`expected Matched, got ${matched?.status}`);
  if (matched.opponent.toLowerCase() !== B.address.toLowerCase()) throw new Error('opponent mismatch');

  // --- assert the duel arithmetic on-chain (§1) ------------------------------
  const ids = await pub.readContract({
    address: venue.module, abi: binaryMarketsModuleAbi, functionName: 'outcomeIds', args: [marketId],
  }) as readonly [bigint, bigint];
  const [upId, downId] = ids;
  const [aUp, bDown, escrowCollateral] = await Promise.all([
    pub.readContract({ address: venue.outcomeToken, abi: outcomeToken6909Abi, functionName: 'balanceOf', args: [A.address, upId] }),
    pub.readContract({ address: venue.outcomeToken, abi: outcomeToken6909Abi, functionName: 'balanceOf', args: [B.address, downId] }),
    market.balance(duels.escrow),
  ]);

  console.log(fmt.head('post-match invariants'));
  check('A holds 2S of UP', aUp >= pot, `${aUp} vs ${pot}`);
  check('B holds 2S of DOWN', bDown >= pot, `${bDown} vs ${pot}`);
  check('escrow holds zero collateral', escrowCollateral === 0n, `${escrowCollateral}`);

  // --- unmatched-refund path (§7, §11) --------------------------------------
  console.log(fmt.head('unmatched refund path'));
  const shortDeadline = Math.min(now() + 45, target.expiryTime - MIN_DEADLINE_MARGIN_SEC);
  if (shortDeadline > now() + 5) {
    const before = await market.balance(A.address);
    const orphan = await duels.open(walletA, A, marketId, 'down', stake, shortDeadline, target.expiryTime);
    note('open (A, orphan)', orphan.txHash);
    const cancelled = await duels.cancel(walletA, A, orphan.duelId);
    note('cancel (A)', cancelled.txHash);
    const after = await market.balance(A.address);
    check('unmatched duel refunds exactly S', after === before, `${after} vs ${before}`);
    const state = await duels.read(orphan.duelId);
    check('orphan status is Cancelled', state?.status === 'Cancelled', String(state?.status));
  } else {
    console.log(fmt.warn('window too short to also test the refund path — rerun earlier in a window'));
  }

  // --- settlement ------------------------------------------------------------
  console.log(fmt.head('settlement'));
  console.log(`Window expires at ${new Date(target.expiryTime * 1000).toISOString()}.`);
  console.log('There is no claim button: settlement lands by itself (§6.2). After the oracle posts,');
  console.log(`the winner calls redeem(${marketId}, <winning id>, ${pot}) for ${unit(pot)};`);
  console.log("the loser's redeem returns 0 and MUST NOT revert (§11).");
  console.log(`Oracle: ${target.oracleQuestionId ? `${cfg.oracleUrl}/${target.oracleQuestionId}?view=graph` : '(no oracleQuestionId on this market)'}`);

  console.log(fmt.head('tx hashes (M3 evidence)'));
  console.table(record);
  market.close();
}

function check(label: string, ok: boolean, detail: string) {
  console.log(ok ? fmt.ok(`${label}  (${detail})`) : fmt.bad(`${label}  (${detail})`));
  if (!ok) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
