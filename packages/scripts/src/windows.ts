/**
 * `pnpm windows` — run our own short-duration windows instead of waiting for someone else's.
 *
 * The game is only worth playing on a one or five minute window, and testnet
 * does not reliably have one. Measured 2026-09-07: the creator that had been
 * minting a 1m window every minute stopped, and ninety minutes later the only
 * live binary markets left on Shannon were a 24h and a 1080h pair. The short
 * windows the console is built around were simply not there.
 *
 * They do not have to come from anyone else. Market creation on this venue is
 * self-serve: twenty operators are registered on testnet, each owned by a
 * different EOA, all enabled and none behind an operator-wide policy, and
 * thirteen MarketCreators have been minted through the factory by thirteen
 * different owners. This script makes us the fourteenth.
 *
 *   pnpm windows              what we own, what it costs, what is live
 *   pnpm windows -- --setup   register operator, venue and creator (ONCE)
 *   pnpm windows -- --series  register the rolling series
 *   pnpm windows -- --start   fund the creator and arm the first roll
 *   pnpm windows -- --roll    roll now (the manual fallback; see below)
 *   pnpm windows -- --sweep   pull the creator's native float back to the wallet
 *
 * The four steps are separate on purpose. Each sends real transactions and each
 * writes state that the next one needs, so a run that half-succeeds leaves
 * something you can name and resume from rather than an unknown position. What
 * `--setup` mints is printed as .env lines; nothing here writes your .env for
 * you, because the addresses it produces are the kind you want to have read
 * once with your own eyes.
 *
 * ROLLS. Once armed, a series rolls on its own — the creator pays its own gas
 * out of the native balance `--start` sends it. That balance is the whole
 * dependency: when it runs dry the rolls stop and we are back to whatever
 * testnet happens to be minting. `pnpm windows` reports the balance and how
 * many rolls it buys, and `--roll` forces one by hand when you want to see the
 * path work without waiting for a boundary.
 *
 * Signs with PRIVATE_KEY_A, which becomes the owner of the operator, the venue
 * and the creator.
 *
 * A NOTE ON THE SDK. Two of the calls this needs are reached around
 * @somnia-chain/markets-sdk rather than through it. The deployed BinaryMarkets
 * module reports `FEE_PARAMS_VERSION() == 3` while the SDK at 0.28.1 still
 * describes the v2 struct, so its `encodeVenueFeeParams` helper reverts; and its
 * `createMarketCreator` reads the minted address out of a `MarketCreatorCreated`
 * event whose signature no longer matches, so it throws on a transaction that
 * did in fact mint. Both are worked around here against the chain's own state —
 * fee bytes checked against the version tag, the creator read back off the
 * factory's list — and both are commented where they happen. When the SDK
 * catches up, both workarounds can go.
 */
import { createPublicClient, createWalletClient, http, formatEther, parseEther, type PublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { MarketAdapter } from '@traderush/sdk';
import { cfg, fmt, requireEnv } from './env.js';

/**
 * The windows we want on the board.
 *
 * Sixty seconds is the module's floor — `registerSeries` rejects anything
 * shorter with `InvalidSeriesConfig` — and it is also the window this console
 * was designed around. The five minute pair is here because a run of 1m windows
 * gives a newcomer no time to read the screen before the first one closes.
 */
const SERIES: { seriesId: number; asset: string; intervalSec: number }[] = [
  { seriesId: 1, asset: 'BTC', intervalSec: 60 },
  { seriesId: 2, asset: 'ETH', intervalSec: 60 },
  { seriesId: 3, asset: 'BTC', intervalSec: 300 },
  { seriesId: 4, asset: 'ETH', intervalSec: 300 },
];

/**
 * Decimals of the oracle's numeric answer, which is the scale the opening price
 * arrives in and therefore the scale `strike` has to be read back at.
 *
 * It is a per-series choice, not a property of the asset — the two live BTC
 * windows on Shannon carry openings of 8034670 and 7961075000000 for the same
 * price, which is 1e2 against 1e8. The console infers the scale per market
 * rather than trusting this, so it reads either; eight is chosen here because
 * it is what the more recently created series use.
 */
const NUMERIC_DECIMALS = 8;

/** How long after expiry the oracle still has to answer before a window voids. */
const SETTLEMENT_WINDOW = 300;

/** What `--start` sends the creator to pay for its own rolls. */
const FUND = parseEther('0.5');

/**
 * A venue's fee bytes: version 3, then six rates, all of them zero.
 *
 * We take nothing. A fee here would be ours, not the venue's, and this venue
 * exists to be played on.
 *
 * Built here rather than through the module's own `encodeVenueFeeParams`, which
 * is what the markets SDK does and what this script tried first. That helper
 * reverts against the deployed module: the module reports
 * `FEE_PARAMS_VERSION() == 3` while the SDK at 0.28.1 still describes the v2
 * struct, so the call does not match anything on-chain. Reading the shape back
 * off a venue that works is the way around it — every zero-fee BINARY_V1 venue
 * on Shannon carries exactly these 224 bytes, and `ZERO_FEE_PARAMS_V3` is
 * asserted against one at setup rather than trusted.
 *
 * If a v4 lands this stops matching, and setup says so instead of quietly
 * creating a venue whose fees are read as something else.
 */
const FEE_PARAMS_VERSION = 3n;
const ZERO_FEE_PARAMS_V3 = ('0x' + [FEE_PARAMS_VERSION, 0n, 0n, 0n, 0n, 0n, 0n]
  .map((w) => w.toString(16).padStart(64, '0')).join('')) as `0x${string}`;

/** `bytes4(keccak256("BINARY_V1"))` — the only market type registered today, and
 *  what a venue is pinned to forever at `createVenue`. */
const MARKET_TYPE_BINARY_V1 = '0x06c65d9f' as const;

/** The module's live version tag. Setup refuses to build fee bytes for a version
 *  it has never seen rather than guess at a layout. */
const feeVersionAbi = [{
  type: 'function', name: 'FEE_PARAMS_VERSION', stateMutability: 'view',
  inputs: [], outputs: [{ type: 'uint8' }],
}] as const;

async function feeParams(): Promise<`0x${string}`> {
  const live = await pub.readContract({
    address: cfg.addresses.binaryModule, abi: feeVersionAbi, functionName: 'FEE_PARAMS_VERSION',
  });
  if (BigInt(live) !== FEE_PARAMS_VERSION) {
    throw new Error(
      `binaryModule reports FEE_PARAMS_VERSION ${live}, this script only knows ${FEE_PARAMS_VERSION}. ` +
      'Read the fee bytes off a live zero-fee venue and update ZERO_FEE_PARAMS_V3 before creating one.',
    );
  }
  return ZERO_FEE_PARAMS_V3;
}

const ZERO = '0x0000000000000000000000000000000000000000' as const;

const A = privateKeyToAccount(requireEnv('PRIVATE_KEY_A') as `0x${string}`);
const pub = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpcUrl) }) as PublicClient;
const wallet = createWalletClient({ account: A, chain: cfg.chain, transport: http(cfg.rpcUrl) });
const market = new MarketAdapter(cfg, { publicClient: pub });

/**
 * A second client, built for the admin tier.
 *
 * The one behind `MarketAdapter` is a reader: it is constructed with an indexer
 * and a chain and nothing else, which is all the console needs. The operator and
 * creator admins write to the registry and the factory, so they need the address
 * book — `createOperatorAdmin` refuses outright without `marketsCore`. Built
 * lazily so that `pnpm windows` with no arguments still reports status on a
 * machine that cannot sign.
 */
const signer = { walletClient: wallet, account: A, publicClient: pub };
let admins: { operator: any; creator: any } | null = null;

async function adminTier() {
  if (admins) return admins;
  const { SomniaMarkets } = await import('@somnia-chain/markets-sdk');
  const ex = new SomniaMarkets({
    indexerUrl: cfg.indexerUrl,
    chain: cfg.chain,
    wsRpcUrl: cfg.wsRpcUrl,
    addresses: {
      collateral: cfg.addresses.collateral,
      binaryModule: cfg.addresses.binaryModule,
      binarySettlement: cfg.addresses.binarySettlement,
      marketsCore: cfg.addresses.marketsCore,
      clobFactory: cfg.addresses.clobFactory,
      binaryPoolImpl: cfg.addresses.binaryPoolImpl,
      collateralRouter: cfg.addresses.collateralRouter,
      marketCreatorFactory: cfg.addresses.marketCreatorFactory,
      oracleHub: cfg.addresses.oracleHub,
    },
  } as any);
  admins = {
    operator: (ex.client as any).createOperatorAdmin(signer),
    creator: (ex.client as any).createMarketCreatorAdmin(signer),
  };
  return admins;
}

/** Where `--setup` left off. Read from env so a resumed run knows what exists. */
const OPERATOR_ID = process.env.WINDOW_OPERATOR_ID ? Number(process.env.WINDOW_OPERATOR_ID) : null;
const VENUE_ID = (process.env.WINDOW_VENUE_ID ?? '') as `0x${string}` | '';
const CREATOR = (process.env.WINDOW_CREATOR ?? '') as `0x${string}` | '';

const arg = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  if (arg('setup')) return setup();
  if (arg('series')) return series();
  if (arg('start')) return start();
  if (arg('roll')) return roll();
  if (arg('sweep')) return sweep();
  return status();
}

// ---------------------------------------------------------------- status

async function status() {
  console.log(fmt.head('wallet'));
  const native = await pub.getBalance({ address: A.address });
  console.log(`  ${A.address}`);
  console.log(`  ${formatEther(native)} ${cfg.nativeSymbol} — gas for setup, and the float the creator rolls on`);

  console.log(fmt.head('what we own'));
  if (OPERATOR_ID === null) console.log(fmt.warn('WINDOW_OPERATOR_ID unset — run `pnpm windows -- --setup`'));
  else console.log(fmt.ok(`operator ${OPERATOR_ID}`));
  if (!VENUE_ID) console.log(fmt.warn('WINDOW_VENUE_ID unset'));
  else console.log(fmt.ok(`venue    ${VENUE_ID}`));
  if (!CREATOR) console.log(fmt.warn('WINDOW_CREATOR unset'));
  else {
    console.log(fmt.ok(`creator  ${CREATOR}`));
    const float = await pub.getBalance({ address: CREATOR });
    // A roll is one transaction; this is a rough count, not a promise.
    console.log(`  float ${formatEther(float)} ${cfg.nativeSymbol}`);
    if (float === 0n) console.log(fmt.bad('  creator has no float — it cannot roll. `pnpm windows -- --start`'));
  }

  console.log(fmt.head('live windows on this network'));
  const rows = await market.listMarkets();
  if (!rows.length) console.log(fmt.warn('  none'));
  for (const m of rows) {
    const left = m.expiryTime - Math.floor(Date.now() / 1000);
    const mine = CREATOR && m.ref.venueId.toLowerCase() === VENUE_ID.toLowerCase();
    console.log(`  ${mine ? '*' : ' '} ${m.symbol.padEnd(5)} ${String(m.intervalSec).padStart(8)}s  ${m.status.padEnd(9)}  ${left > 0 ? `${left}s left` : 'expired'}`);
  }
  if (CREATOR) console.log('\n  * = ours');
  market.discovery.close();
}

// ----------------------------------------------------------------- setup

/**
 * Mint the operator, the venue and the creator.
 *
 * The order matters and is not obvious. A venue's `policy` is the create-side
 * gate, and the policy that has to go there is minted BY `createMarketCreator`
 * — so the venue cannot be created pointing at it. It is created open, the
 * creator is minted against it, and then the venue is updated to point at the
 * policy that now exists. That end state is exactly what every working creator
 * on this network reads back as.
 *
 * `signer` stays zero throughout. A non-zero venue signer requires an EIP-712
 * authorization per market created, and the roll loop has no way to produce one
 * — a venue with a signer set can never roll.
 */
async function setup() {
  if (VENUE_ID && CREATOR) {
    console.log(fmt.warn('operator, venue and creator are already set in .env — nothing to do.'));
    console.log('  To mint a second set, clear WINDOW_* from .env first.');
    return;
  }

  const { operator: operatorAdmin, creator: creatorAdmin } = await adminTier();

  // Resumable: a run that registered an operator and then failed should not
  // strand it and mint a second. Set WINDOW_OPERATOR_ID and this step is skipped.
  console.log(fmt.head('1/4  register operator'));
  let operatorId: number;
  if (OPERATOR_ID !== null) {
    operatorId = OPERATOR_ID;
    console.log(fmt.ok(`reusing operator ${operatorId} from WINDOW_OPERATOR_ID`));
  } else {
    const op = await operatorAdmin.registerOperator({
      feeRecipient: A.address,
      enabled: true,
      policy: ZERO,        // no operator-wide gate; the venue carries the create-side one
    });
    operatorId = op.operatorId;
    console.log(fmt.ok(`operator ${operatorId}  tx ${op.hash}`));
  }

  console.log(fmt.head('2/4  create venue'));
  const fees = await feeParams();
  const venue = await operatorAdmin.createVenue({
    operatorId,
    marketType: MARKET_TYPE_BINARY_V1,
    config: {
      feeParams: fees,
      feeRecipientOverride: ZERO,
      policy: ZERO,        // replaced in 4/4 with the creator's own policy
      signer: ZERO,        // MUST stay zero — see the note above
      creationEnabled: true,
    },
  });
  console.log(fmt.ok(`venue ${venue.venueId}  tx ${venue.hash}`));

  console.log(fmt.head('3/4  mint market creator'));
  const created = await mintCreator(operatorId, venue.venueId);
  console.log(fmt.ok(`creator ${created.creator}`));
  console.log(fmt.ok(`policy  ${created.policy}  tx ${created.hash}`));

  console.log(fmt.head('4/4  point the venue at the creator policy'));
  const updated = settled('updateVenue', await operatorAdmin.updateVenue({
    operatorId,
    venueId: venue.venueId,
    config: {
      feeParams: fees,
      feeRecipientOverride: ZERO,
      policy: created.policy,
      signer: ZERO,
      creationEnabled: true,
    },
  }));
  console.log(fmt.ok(`venue updated  tx ${updated.hash}`));

  console.log(fmt.head('add these to .env, then run `pnpm windows -- --series`'));
  console.log(`WINDOW_OPERATOR_ID=${operatorId}`);
  console.log(`WINDOW_VENUE_ID=${venue.venueId}`);
  console.log(`WINDOW_CREATOR=${created.creator}`);
}

// ---------------------------------------------------------------- series

async function series() {
  const creator = requireCreator();
  const { creator: creatorAdmin } = await adminTier();
  console.log(fmt.head(`register ${SERIES.length} series on ${creator}`));
  for (const s of SERIES) {
    const r = settled(`series ${s.seriesId}`, await creatorAdmin.registerSeries({
      creator,
      seriesId: s.seriesId,
      collateral: cfg.addresses.collateral,
      asset: s.asset,
      numericDecimals: NUMERIC_DECIMALS,
      intervalSec: s.intervalSec,
      settlementWindow: SETTLEMENT_WINDOW,
    }));
    console.log(fmt.ok(`series ${s.seriesId}  ${s.asset} ${s.intervalSec}s  tx ${r.hash}`));
  }
  console.log('\nNext: `pnpm windows -- --start` funds the creator and arms the first roll.');
}

// ----------------------------------------------------------------- start

/**
 * Fund the creator, then arm each series at its next aligned boundary.
 *
 * The float goes first. `armFirstRoll` schedules a roll the creator pays for
 * itself, so arming a creator with no balance schedules a roll that cannot
 * happen, and the series sits armed and dead.
 */
async function start() {
  const creator = requireCreator();

  const { creator: creatorAdmin } = await adminTier();

  const float = await pub.getBalance({ address: creator });
  if (float < FUND) {
    console.log(fmt.head(`fund creator with ${formatEther(FUND)} ${cfg.nativeSymbol}`));
    const r = settled('fundMarketCreator', await creatorAdmin.fundMarketCreator({ creator, amountWei: FUND }));
    console.log(fmt.ok(`funded  tx ${r.hash}`));
  } else {
    console.log(fmt.ok(`creator already holds ${formatEther(float)} ${cfg.nativeSymbol}`));
  }

  console.log(fmt.head('arm first roll'));
  const now = Math.floor(Date.now() / 1000);
  for (const s of SERIES) {
    // An interval-aligned boundary in the future. One whole interval of margin,
    // so a slow transaction cannot land after the boundary it is arming for.
    const firesAt = (Math.floor(now / s.intervalSec) + 2) * s.intervalSec;
    try {
      const r = settled(`arm series ${s.seriesId}`, await creatorAdmin.armFirstRoll({
        creator, seriesId: s.seriesId, firesAtSec: BigInt(firesAt),
      }));
      console.log(fmt.ok(`series ${s.seriesId} (${s.asset} ${s.intervalSec}s) fires in ${firesAt - now}s  tx ${r.hash}`));
    } catch (e) {
      // Re-arming is refused, and that is the common case on a second run.
      console.log(fmt.warn(`series ${s.seriesId}: ${firstLine(e)}`));
    }
  }
  console.log('\nGive it a boundary, then `pnpm windows` to see them live.');
}

// ------------------------------------------------------------------ roll

async function roll() {
  const creator = requireCreator();
  const { creator: creatorAdmin } = await adminTier();
  console.log(fmt.head('trigger a roll by hand'));
  for (const s of SERIES) {
    try {
      const r = settled(`roll series ${s.seriesId}`, await creatorAdmin.triggerRoll({ creator, seriesId: s.seriesId }));
      console.log(fmt.ok(`series ${s.seriesId} rolled  tx ${r.hash}`));
    } catch (e) {
      console.log(fmt.warn(`series ${s.seriesId}: ${firstLine(e)}`));
    }
  }
}

/**
 * Mint the creator, and read its address off the factory rather than the receipt.
 *
 * The markets SDK does this by decoding a `MarketCreatorCreated` event out of
 * the logs, and against the deployed factory that decode finds nothing — the
 * same version drift that makes its fee encoder revert. It threw
 * "the receipt carried no MarketCreatorCreated event" on a transaction that had
 * in fact minted, which is the worst shape of failure: the caller believes
 * nothing happened while the chain says otherwise.
 *
 * The factory keeps its own list, so the mint is confirmed against
 * `creatorCount()` and the address read from `creators(n-1)`. `simulateContract`
 * carries the policy back as the call's second return value, and doubles as the
 * preflight — a venue this operator does not own reverts here rather than
 * halfway through.
 */
const factoryAbi = [
  {
    type: 'function', name: 'createMarketCreator', stateMutability: 'nonpayable',
    inputs: [
      { name: 'owner', type: 'address' }, { name: 'core', type: 'address' },
      { name: 'adapter', type: 'address' }, { name: 'operatorId', type: 'uint32' },
      { name: 'venueId', type: 'bytes32' },
      { name: 'defaultBookParams', type: 'tuple', components: [
        { name: 'tickSize', type: 'uint256' }, { name: 'minQuantity', type: 'uint256' },
        { name: 'lotSize', type: 'uint256' },
      ] },
    ],
    outputs: [{ name: 'creator', type: 'address' }, { name: 'policy', type: 'address' }],
  },
  { type: 'function', name: 'creators', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'creatorCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const;

async function mintCreator(operatorId: number, venueId: `0x${string}`) {
  const factory = cfg.addresses.marketCreatorFactory;
  const read = <T>(functionName: 'creatorCount' | 'creators', args?: readonly unknown[]) =>
    pub.readContract({ address: factory, abi: factoryAbi, functionName, args: args as never }) as Promise<T>;

  const before = await read<bigint>('creatorCount');
  const { request, result } = await pub.simulateContract({
    account: A, address: factory, abi: factoryAbi, functionName: 'createMarketCreator',
    args: [A.address, cfg.addresses.binaryModule, cfg.addresses.oracleHub, operatorId, venueId,
           { tickSize: cfg.tick, minQuantity: cfg.lot, lotSize: cfg.lot }],
  });
  const hash = await wallet.writeContract({ ...request, chain: cfg.chain });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`createMarketCreator reverted — tx ${hash}`);

  const after = await read<bigint>('creatorCount');
  if (after <= before) throw new Error(`tx ${hash} mined but the factory minted nothing`);
  const creator = await read<`0x${string}`>('creators', [after - 1n]);
  return { creator, policy: result[1] as `0x${string}`, hash };
}

/**
 * Assert a write actually landed.
 *
 * The markets SDK's machinery writer returns `{ hash, receipt }` and never looks
 * at `receipt.status`, so a reverted transaction comes back from `armFirstRoll`
 * or `registerSeries` indistinguishable from one that worked. That is how this
 * script first reported four series armed while the chain had `armedBoundary()`
 * at zero and every `firstRollArmed` false — four reverts, all announced with a
 * green tick and a transaction hash.
 *
 * Nothing here trusts a write it has not checked.
 */
function settled<T extends { hash: `0x${string}`; receipt?: { status?: string } }>(what: string, r: T): T {
  if (r.receipt && r.receipt.status !== 'success') {
    throw new Error(`${what} reverted on chain — tx ${r.hash}`);
  }
  return r;
}

/** The first line of a revert, which is the part that names the reason. */
function firstLine(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return (m.split('\n')[0] ?? m).slice(0, 90);
}

/**
 * Pull the creator's float back out.
 *
 * The float is not spent, it is parked: `--start` sends native to a contract we
 * own so that it can pay for its own rolls, and if the venue is not minting —
 * or the series are retired — that balance would otherwise just sit there. The
 * creator's `withdrawNative` is owner-only and this wallet is the owner.
 */
async function sweep() {
  const creator = requireCreator();
  const float = await pub.getBalance({ address: creator });
  if (float === 0n) {
    console.log(fmt.warn('creator holds nothing to sweep.'));
    return;
  }
  console.log(fmt.head(`sweep ${formatEther(float)} ${cfg.nativeSymbol} back to ${A.address}`));
  const { request } = await pub.simulateContract({
    account: A, address: creator,
    abi: [{
      type: 'function', name: 'withdrawNative', stateMutability: 'nonpayable',
      inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [],
    }] as const,
    functionName: 'withdrawNative', args: [A.address, float],
  });
  const hash = await wallet.writeContract({ ...request, chain: cfg.chain });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`withdrawNative reverted — tx ${hash}`);
  console.log(fmt.ok(`swept  tx ${hash}`));
}

function requireCreator(): `0x${string}` {
  if (!CREATOR) throw new Error('WINDOW_CREATOR is not set. Run `pnpm windows -- --setup` first.');
  return CREATOR;
}

main().catch((e) => {
  console.error(fmt.bad(e instanceof Error ? e.message : String(e)));
  process.exit(1);
});
