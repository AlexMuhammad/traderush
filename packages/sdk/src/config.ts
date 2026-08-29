import type { Chain } from 'viem';
import {
  DEPLOYMENTS, chainFor, parseNetwork,
  type Address, type Deployment, type Network,
} from './networks.js';

export type { Network, Address, Deployment } from './networks.js';
export { DEPLOYMENTS, chainFor, parseNetwork } from './networks.js';

/** Everything network-specific resolves here. To go to mainnet, set ONE variable:
 *
 *      NETWORK=mainnet        (scripts)
 *      VITE_NETWORK=mainnet   (web)
 *
 *  Chain id, RPC, indexer, collateral, decimals, tick/lot and venue all follow.
 *  Any single value can still be overridden from env for the case where a redeploy
 *  lands before this map is updated. */
export interface BullrunConfig extends Deployment {
  /** Per-network escrow. A mainnet deploy is a DIFFERENT address than testnet,
   *  so this is read per network and never shared. */
  escrowAddress: Address | null;
  /**
   * Only filter markets to `venueId` when VENUE_ID was set explicitly.
   *
   * The deployment map's venue is a documented starting point, not a fence.
   * Scoping to it by default hid every short window: on Shannon the 1m and 5m
   * markets live on a different venue than the 1h/4h/24h ones, and a console
   * showing only hour-long windows is unwatchable.
   *
   * Reading across venues is safe because a market carries its own origin —
   * DuelEscrow reads `originOperatorId`/`originVenueId` out of `markets()`
   * on-chain and never trusts config for it. Set VENUE_ID to pin one anyway.
   */
  scopeToVenue: boolean;
  chain: Chain;
  apiKey?: string;
  /**
   * Privy app id — the PUBLIC half. It ships in the browser bundle by design.
   *
   * The app SECRET must never appear here, in .env, or anywhere in this repo:
   * it is a server credential, and this product has no server (§12). Anything
   * holding it can act as the app.
   */
  privyAppId: string | null;
}

type EnvBag = Record<string, string | undefined>;

export function loadConfig(env: EnvBag = {}): BullrunConfig {
  // Accept both plain and VITE_-prefixed names so scripts and the web app read
  // the same .env without two sets of keys.
  const get = (k: string) => env[`VITE_${k}`] ?? env[k];

  const network: Network = parseNetwork(get('NETWORK'));
  const d = DEPLOYMENTS[network];

  const num = (k: string, fallback: number): number => {
    const raw = get(k);
    if (raw === undefined || raw.trim() === '') return fallback;
    const n = Number(raw);
    // A typo'd number must not become NaN and silently disable a guard.
    if (!Number.isFinite(n)) throw new Error(`${k}="${raw}" is not a number`);
    return n;
  };
  const big = (k: string, fallback: bigint): bigint => {
    const raw = get(k);
    if (raw === undefined || raw.trim() === '') return fallback;
    return BigInt(raw);
  };
  const addr = (k: string, fallback: Address): Address => {
    const raw = get(k)?.trim();
    return raw && /^0x[0-9a-fA-F]{40}$/.test(raw) ? (raw as Address) : fallback;
  };

  // The escrow is per-network: DUEL_ESCROW_ADDRESS_MAINNET wins on mainnet, so
  // one .env can carry both deployments and the switch stays a single variable.
  const escrowRaw = (get(`DUEL_ESCROW_ADDRESS_${network.toUpperCase()}`) ?? get('DUEL_ESCROW_ADDRESS') ?? '').trim();

  return {
    ...d,
    chainId: num('CHAIN_ID', d.chainId),
    decimals: num('DECIMALS', d.decimals),
    rpcUrl: get('RPC_URL') ?? d.rpcUrl,
    wsRpcUrl: get('WS_RPC_URL') ?? d.wsRpcUrl,
    indexerUrl: get('INDEXER_URL') ?? d.indexerUrl,
    restUrl: get('REST_URL') ?? d.restUrl,
    explorerUrl: get('EXPLORER_URL') ?? d.explorerUrl,
    oracleUrl: get('ORACLE_URL') ?? d.oracleUrl,
    tick: big('MM_TICK', d.tick),
    lot: big('MM_LOT', d.lot),
    venueId: addr('VENUE_ID', d.venueId) as Address,
    scopeToVenue: Boolean(get('VENUE_ID')?.trim()),
    addresses: {
      ...d.addresses,
      collateral: addr('COLLATERAL', d.addresses.collateral),
      binaryModule: addr('BINARY_MODULE', d.addresses.binaryModule),
    },
    escrowAddress: /^0x[0-9a-fA-F]{40}$/.test(escrowRaw) ? (escrowRaw as Address) : null,
    chain: chainFor(network),
    apiKey: get('DREAMDEX_API_KEY'),
    privyAppId: get('PRIVY_APP_ID')?.trim() || null,
  };
}

export const txUrl = (cfg: BullrunConfig, hash: string) => `${cfg.explorerUrl}/tx/${hash}`;
export const addressUrl = (cfg: BullrunConfig, a: string) => `${cfg.explorerUrl}/address/${a}`;
export const oracleUrl = (cfg: BullrunConfig, questionId: string) =>
  `${cfg.oracleUrl}/${questionId}?view=graph`;

/** §5.3 — link format. State lives on-chain, so the link carries no secrets and no
 *  stake/side query params, which would be display-only and could disagree with the
 *  chain. The chainId in the path is what makes a testnet link refuse to open against
 *  a mainnet app. */
export const duelLink = (chainId: number, escrow: string, duelId: bigint | number | string) =>
  `/d/${chainId}/${escrow}/${duelId}`;
