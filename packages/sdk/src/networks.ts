import { defineChain, type Chain } from 'viem';

/** Per-network deployment map.
 *
 *  Switching to mainnet is ONE variable: `NETWORK=mainnet` (or `VITE_NETWORK`).
 *  Everything below — chain id, RPC, indexer, collateral, decimals, tick/lot,
 *  venue — moves with it. Nothing in the app reads a network-specific constant
 *  directly; it all comes through `loadConfig()`.
 *
 *  Sourced from dreamdex-bot-kit `packages/ec-core/src/{addresses,config}.ts`,
 *  which bundles the deployment rather than fetching it: `@somnia-chain/deployments`
 *  is private and not installable outside the somnia-markets monorepo.
 *
 *  Verified on Shannon 2026-08-29: `binaryModule` and `binarySettlement` have code,
 *  and the testnet collateral's `decimals()` really does return 6.
 */

export type Network = 'testnet' | 'mainnet';
export type Address = `0x${string}`;

/** Protocol core — CREATE3-deterministic, so identical on both chains. */
const CORE = {
  binaryModule: '0x3ecC694Cef705358864a646142ac17A90E29e388',
  marketsCore: '0x2802504314685D89bF6C992CA5a8e7cC78bc0294',
  clobFactory: '0xb2BE8EE02F96379DB75f01802384593EBa9bfF04',
  binaryPoolImpl: '0x82A1FcdaA2daC2fC7D5f9909D43E68021eE966FD',
  binarySettlement: '0xbF4a49e0Dfd092e5FBE8E5761064C49533e6Ed23',
  collateralRouter: '0xbC0C9834B15ACE38bB50dDaa7d7f7C7CC4DC183C',
  marketCreatorFactory: '0xE6bEE93cE87c9E6e62aCb621caa7832EE47b4F6B',
  oracleHub: '0xe40db387cC98601Dd11bd634fF2f3AD5686dE32b',
} as const;

/** Every address the app can reach for. Named rather than a loose record so a
 *  caller cannot silently read `undefined` off a key that does not exist. */
export interface DeploymentAddresses {
  /** The collateral token: tUSDC (6dp) on testnet, USDso (18dp) on mainnet. */
  collateral: Address;
  /** BinaryMarketsModule — mintCompleteSet / mergeCompleteSet / redeem / markets. */
  binaryModule: Address;
  binarySettlement: Address;
  marketsCore: Address;
  clobFactory: Address;
  binaryPoolImpl: Address;
  collateralRouter: Address;
  marketCreatorFactory: Address;
  oracleHub: Address;
  /** Per-network; only a discovery hint, the module emits every MarketCreated. */
  marketCreator: Address;
}

export interface Deployment {
  network: Network;
  chainId: number;
  chainName: string;
  nativeSymbol: string;
  /** Collateral decimals: 6 (tUSDC) on testnet, 18 (USDso) on mainnet.
   *  NEVER hard-code 18 in the UI — testnet would silently render 1e12x too small. */
  decimals: number;
  collateralSymbol: string;
  rpcUrl: string;
  wsRpcUrl: string;
  /** Binary/event-contract markets live in the indexer, NOT in the REST
   *  /v0/markets registry — that one serves spot and perp only. */
  indexerUrl: string;
  /** REST venue for spot/perp book data. Not where event contracts live. */
  restUrl: string;
  explorerUrl: string;
  oracleUrl: string;
  addresses: DeploymentAddresses;
  /** Book granularity in raw units, as a FALLBACK.
   *
   *  These are discoverable after all — `getBinaryBookParams(pool)` reads the
   *  pool's own tick, lot and minimum, and that is what an order is snapped to.
   *  A live testnet pool answers tick 1000, lot 1000, min 1000; this config said
   *  lot 1, and the chain replied `InvalidQuantity(5917159, 1000)`. Trust the
   *  pool; these only size a quote before one is known. */
  tick: bigint;
  lot: bigint;
  /** bytes32 venue id. **These move** — both networks changed venue three times in
   *  the first week of August 2026. If reads return no markets, take the venueId
   *  off a live market row rather than trusting this default. */
  venueId: Address;
  /** Testnet has a faucet; mainnet collateral is a real stablecoin. */
  faucet: boolean;
}

export const DEPLOYMENTS: Record<Network, Deployment> = {
  testnet: {
    network: 'testnet',
    chainId: 50312,
    chainName: 'Somnia Shannon Testnet',
    nativeSymbol: 'STT',
    decimals: 6,
    collateralSymbol: 'tUSDC',
    rpcUrl: 'https://api.infra.testnet.somnia.network',
    wsRpcUrl: 'wss://api.infra.testnet.somnia.network/ws',
    indexerUrl: 'https://dev.smk.somnia.host/v1/graphql',
    restUrl: 'https://stg.api.dreamdex.io/v0',
    explorerUrl: 'https://shannon-explorer.somnia.network',
    oracleUrl: 'https://prd.oracle.somnia.host/questions',
    addresses: {
      ...CORE,
      // TestUSDC — public `faucet(uint256)`, 6 dp
      collateral: '0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E',
      marketCreator: '0x5Ce69567dB39C8fBAd7e048bEfdbcCdfE67B44e6',
    },
    // Measured: the testnet venue accepted orders down to 1 raw unit.
    tick: 1_000n,
    lot: 1_000n,
    venueId: '0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c',
    faucet: true,
  },
  mainnet: {
    network: 'mainnet',
    chainId: 5031,
    chainName: 'Somnia',
    nativeSymbol: 'SOMI',
    decimals: 18,
    collateralSymbol: 'USDso',
    rpcUrl: 'https://api.infra.mainnet.somnia.network',
    wsRpcUrl: 'wss://api.infra.mainnet.somnia.network/ws',
    indexerUrl: 'https://prd.smk.somnia.host/v1/graphql',
    restUrl: 'https://api.dreamdex.io/v0',
    explorerUrl: 'https://explorer.somnia.network',
    oracleUrl: 'https://prd.oracle.somnia.host/questions',
    addresses: {
      ...CORE,
      // USDso — a real stablecoin, 18 dp, no faucet
      collateral: '0x00000022dA000002656c64D9eA6011ea952D008A',
      marketCreator: '0x62627805965705Cc303A7F6282DD5059921980aD',
    },
    // Per venues.json `bookParams` on the USDso venue.
    tick: 1_000_000_000_000_000n,
    lot: 1_000_000_000_000_000n,
    venueId: '0x458b30c2d72bfd2c6317304a4594ecbafe5f729d3111b65fdc3a33bd48e5432d',
    faucet: false,
  },
};

const chainCache = new Map<Network, Chain>();

export function chainFor(net: Network): Chain {
  const cached = chainCache.get(net);
  if (cached) return cached;
  const d = DEPLOYMENTS[net];
  const chain = defineChain({
    id: d.chainId,
    name: d.chainName,
    nativeCurrency: { name: d.nativeSymbol, symbol: d.nativeSymbol, decimals: 18 },
    rpcUrls: { default: { http: [d.rpcUrl] } },
    blockExplorers: { default: { name: `${d.chainName} Explorer`, url: d.explorerUrl } },
    testnet: net === 'testnet',
  });
  chainCache.set(net, chain);
  return chain;
}

export function parseNetwork(raw: string | undefined): Network {
  return (raw ?? '').trim().toLowerCase() === 'mainnet' ? 'mainnet' : 'testnet';
}
