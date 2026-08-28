import {
  createPublicClient, http, decodeEventLog,
  type PublicClient, type WalletClient, type Account,
} from 'viem';
import type { BullrunConfig } from './config.js';
import { duelLink } from './config.js';
import { duelEscrowAbi, erc20Abi } from './abi.js';
import { assertDeadlineSafe } from './ticks.js';
import type { Duel, DuelStatus, DuelView, Side, TxResult } from './types.js';

const DUEL_STATUS: DuelStatus[] = ['None', 'Open', 'Matched', 'Cancelled'];

export interface DuelAdapterOptions {
  publicClient?: PublicClient;
  /** Poll interval for watch(). Polling is the source of truth (§5.2). */
  pollMs?: number;
}

/** §5.2 — escrow only. No book, no liquidity, no market maker. */
export class DuelAdapter {
  readonly escrow: `0x${string}`;
  readonly publicClient: PublicClient;
  private readonly pollMs: number;

  constructor(
    private readonly cfg: BullrunConfig,
    escrowAddress?: `0x${string}`,
    opts: DuelAdapterOptions = {},
  ) {
    const addr = escrowAddress ?? cfg.escrowAddress;
    if (!addr) {
      throw new Error(
        `DUEL_ESCROW_ADDRESS is not set for ${cfg.network} — deploy DuelEscrow on chain ` +
        `${cfg.chainId} first (M3). Each network needs its own deploy; set ` +
        `DUEL_ESCROW_ADDRESS_${cfg.network.toUpperCase()} in .env.`,
      );
    }
    this.escrow = addr;
    this.publicClient = opts.publicClient ?? (createPublicClient({
      chain: cfg.chain, transport: http(cfg.rpcUrl),
    }) as PublicClient);
    this.pollMs = opts.pollMs ?? 3_000;
  }

  // ------------------------------------------------------------------ writes

  /** One-time approval so `open`/`accept` can pull the stake. */
  async approve(wallet: WalletClient, account: Account, collateral: `0x${string}`, amount: bigint): Promise<TxResult> {
    const hash = await wallet.writeContract({
      chain: this.cfg.chain, account, address: collateral,
      abi: erc20Abi, functionName: 'approve', args: [this.escrow, amount],
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return { txHash: hash };
  }

  async allowance(collateral: `0x${string}`, owner: `0x${string}`): Promise<bigint> {
    return this.publicClient.readContract({
      address: collateral, abi: erc20Abi, functionName: 'allowance', args: [owner, this.escrow],
    });
  }

  /** Opens a challenge. Nothing is minted until someone accepts, so an unmatched
   *  challenge is always refundable in full (§7). */
  async open(
    wallet: WalletClient, account: Account,
    marketId: `0x${string}`, side: Side, stake: bigint,
    acceptDeadline: number, marketExpiryTime?: number,
  ): Promise<{ duelId: bigint; txHash: `0x${string}`; link: string }> {
    // Gotcha §8.11 — accepting into a locking market reverts inside mintCompleteSet
    // and burns gas for both parties.
    if (marketExpiryTime) assertDeadlineSafe(acceptDeadline, marketExpiryTime);

    const challengerUp = side === 'up';
    // Gotcha §8.1 — simulate against current on-chain state before writing.
    const { request } = await this.publicClient.simulateContract({
      account, address: this.escrow, abi: duelEscrowAbi, functionName: 'open',
      args: [marketId, challengerUp, stake, BigInt(acceptDeadline)],
    });
    const txHash = await wallet.writeContract({ ...request, chain: this.cfg.chain });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });

    let duelId: bigint | null = null;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== this.escrow.toLowerCase()) continue;
      try {
        const ev = decodeEventLog({ abi: duelEscrowAbi, data: log.data, topics: log.topics });
        if (ev.eventName === 'Opened') { duelId = (ev.args as { id: bigint }).id; break; }
      } catch { /* not ours */ }
    }
    if (duelId === null) throw new Error(`open() mined in ${txHash} but emitted no Opened event`);

    return { duelId, txHash, link: this.link(duelId) };
  }

  async accept(wallet: WalletClient, account: Account, duelId: bigint): Promise<TxResult> {
    const { request } = await this.publicClient.simulateContract({
      account, address: this.escrow, abi: duelEscrowAbi, functionName: 'accept', args: [duelId],
    });
    const txHash = await wallet.writeContract({ ...request, chain: this.cfg.chain });
    await this.publicClient.waitForTransactionReceipt({ hash: txHash });
    return { txHash };
  }

  async cancel(wallet: WalletClient, account: Account, duelId: bigint): Promise<TxResult> {
    const { request } = await this.publicClient.simulateContract({
      account, address: this.escrow, abi: duelEscrowAbi, functionName: 'cancel', args: [duelId],
    });
    const txHash = await wallet.writeContract({ ...request, chain: this.cfg.chain });
    await this.publicClient.waitForTransactionReceipt({ hash: txHash });
    return { txHash };
  }

  // ------------------------------------------------------------------- reads

  async read(duelId: bigint): Promise<DuelView | null> {
    const raw = await this.publicClient.readContract({
      address: this.escrow, abi: duelEscrowAbi, functionName: 'duels', args: [duelId],
    }) as readonly [`0x${string}`, `0x${string}`, `0x${string}`, bigint, bigint, boolean, number];

    const status = DUEL_STATUS[Number(raw[6])] ?? 'None';
    if (status === 'None') return null;

    const duel: Duel = {
      id: duelId,
      challenger: raw[0],
      opponent: raw[1],
      marketId: raw[2],
      stake: raw[3],
      acceptDeadline: Number(raw[4]),
      challengerUp: raw[5],
      status,
    };
    return {
      ...duel,
      pot: duel.stake * 2n, // §1 — pot = 2S; the escrow mints exactly this many sets
      expired: status === 'Open' && Date.now() / 1000 >= duel.acceptDeadline,
    };
  }

  /** §5.2 — polls duels(id) every 3s AND subscribes to Matched.
   *  Polling is the source of truth; the event is the fast path. Relying on the event
   *  alone strands a user in the lobby forever if the socket drops at the wrong moment. */
  watch(duelId: bigint, onChange: (duel: DuelView | null) => void): () => void {
    let stopped = false;
    let last = '';

    const emit = (d: DuelView | null) => {
      if (stopped) return;
      const key = d ? `${d.status}:${d.opponent}:${d.expired}` : 'null';
      if (key === last) return;
      last = key;
      onChange(d ? { ...d } : null); // fresh object; consumers diff by value
    };

    const poll = async () => {
      try { emit(await this.read(duelId)); } catch { /* keep polling; never throw from watch */ }
    };

    void poll();
    const timer = setInterval(() => void poll(), this.pollMs);

    // Fast path. If this fails or the socket drops, the poller above still resolves it.
    let unwatchEvent: (() => void) | undefined;
    try {
      unwatchEvent = this.publicClient.watchContractEvent({
        address: this.escrow,
        abi: duelEscrowAbi,
        eventName: 'Matched',
        args: { id: duelId },
        onLogs: () => void poll(),
        onError: () => { /* poller is the source of truth */ },
      });
    } catch { /* no filter support on this RPC — polling covers it */ }

    return () => {
      stopped = true;
      clearInterval(timer);
      unwatchEvent?.();
    };
  }

  /** §5.3 — /d/<chainId>/<escrowAddress>/<duelId>. No secrets, no signature needed. */
  link(duelId: bigint | number | string, chainId: number = this.cfg.chainId): string {
    return duelLink(chainId, this.escrow, duelId);
  }

  /** Reads the venue wiring straight off the deployed escrow — a second, independent
   *  check that the escrow points at the same addresses GET /markets reports. */
  async venue(): Promise<{ collateral: `0x${string}`; module: `0x${string}`; outcome: `0x${string}` }> {
    const [collateral, moduleAddr, outcome] = await Promise.all([
      this.publicClient.readContract({ address: this.escrow, abi: duelEscrowAbi, functionName: 'collateral' }),
      this.publicClient.readContract({ address: this.escrow, abi: duelEscrowAbi, functionName: 'module' }),
      this.publicClient.readContract({ address: this.escrow, abi: duelEscrowAbi, functionName: 'outcome' }),
    ]);
    return { collateral, module: moduleAddr, outcome };
  }
}

/** Parses /d/<chainId>/<escrow>/<duelId> back out of a URL path (S8). */
export function parseDuelLink(path: string): { chainId: number; escrow: `0x${string}`; duelId: bigint } | null {
  const m = /^\/d\/(\d+)\/(0x[0-9a-fA-F]{40})\/(\d+)$/.exec(path.split('?')[0] ?? '');
  if (!m) return null;
  return { chainId: Number(m[1]), escrow: m[2] as `0x${string}`, duelId: BigInt(m[3]!) };
}
