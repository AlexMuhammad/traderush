import { defineChain } from 'viem';

/** §2 — endpoints and constants. Contract addresses are NOT here on purpose:
 *  they are re-fetchable at runtime from GET /v0/markets. Never hard-code them. */
export const CHAIN_ID = 50312;

export const DEFAULTS = {
  rpcUrl: 'https://dream-rpc.somnia.network',
  restUrl: 'https://stg.api.dreamdex.io/v0',
  wsUrl: 'wss://stg.api.dreamdex.io/v0/ws/public',
  oracleUrl: 'https://prd.oracle.somnia.host/questions',
  explorerUrl: 'https://shannon-explorer.somnia.network',
} as const;

export interface BullrunConfig {
  chainId: number;
  rpcUrl: string;
  restUrl: string;
  wsUrl: string;
  oracleUrl: string;
  explorerUrl: string;
  /** Filled in after M3; read from env, never committed. */
  escrowAddress: `0x${string}` | null;
}

type EnvBag = Record<string, string | undefined>;

/** Reads Vite (`VITE_*`) or Node (`process.env`) without assuming either exists. */
export function loadConfig(env: EnvBag = {}): BullrunConfig {
  const get = (k: string) => env[`VITE_${k}`] ?? env[k];
  const escrow = get('DUEL_ESCROW_ADDRESS');
  return {
    chainId: Number(get('CHAIN_ID') ?? CHAIN_ID),
    rpcUrl: get('RPC_URL') ?? DEFAULTS.rpcUrl,
    restUrl: get('REST_URL') ?? DEFAULTS.restUrl,
    wsUrl: get('WS_URL') ?? DEFAULTS.wsUrl,
    oracleUrl: get('ORACLE_URL') ?? DEFAULTS.oracleUrl,
    explorerUrl: get('EXPLORER_URL') ?? DEFAULTS.explorerUrl,
    escrowAddress: escrow && escrow.startsWith('0x') ? (escrow as `0x${string}`) : null,
  };
}

export const shannon = defineChain({
  id: CHAIN_ID,
  name: 'Somnia Shannon Testnet',
  nativeCurrency: { name: 'Somnia Test Token', symbol: 'STT', decimals: 18 },
  rpcUrls: { default: { http: [DEFAULTS.rpcUrl] } },
  blockExplorers: { default: { name: 'Shannon Explorer', url: DEFAULTS.explorerUrl } },
  testnet: true,
});

export const txUrl = (cfg: BullrunConfig, hash: string) => `${cfg.explorerUrl}/tx/${hash}`;
export const addressUrl = (cfg: BullrunConfig, addr: string) => `${cfg.explorerUrl}/address/${addr}`;
export const oracleUrl = (cfg: BullrunConfig, questionId: string) =>
  `${cfg.oracleUrl}/${questionId}?view=graph`;

/** §5.3 — link format. State lives on-chain, so the link carries no secrets and no
 *  stake/side query params, which would be display-only and could disagree with the chain. */
export const duelLink = (chainId: number, escrow: string, duelId: bigint | number | string) =>
  `/d/${chainId}/${escrow}/${duelId}`;
