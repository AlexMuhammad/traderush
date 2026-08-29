import {
  createPublicClient, http, decodeEventLog,
  type PublicClient, type WalletClient, type Account,
} from 'viem';
import type { TradeRushConfig } from './config.js';
import { roomEscrowAbi } from './roomAbi.js';
import { erc20Abi } from './abi.js';
import { assertDeadlineSafe } from './ticks.js';
import type { Side, TxResult } from './types.js';

/** A room as the screens need it. */
export interface Room {
  id: bigint;
  marketId: `0x${string}`;
  entryDeadline: number;
  totalUp: bigint;
  totalDown: bigint;
  /** The whole prize. Not "what the losers put in" — the winning side takes it all. */
  pot: bigint;
  /** True once nobody can join. */
  closed: boolean;
  /** Everyone on one side: nothing to win, everyone refunds. */
  oneSided: boolean;
  /** One-sided and already merged back to collateral. */
  unwound: boolean;
}

/** What one player stands to get out of a room. */
export interface Seat {
  up: bigint;
  down: bigint;
  /** Outcome tokens claimable on each leg. Zero once claimed. */
  shareUp: bigint;
  shareDown: bigint;
  settled: boolean;
}

export interface RoomAdapterOptions {
  publicClient?: PublicClient;
  /** Poll interval for watch(). Polling is the source of truth (§5.2). */
  pollMs?: number;
}

/**
 * Rooms: many players, either side, any size.
 *
 * Payouts float. Five on UP against three on DOWN pays the UP side 1.6x and the
 * DOWN side 2.67x — parimutuel, which is what buys the room its one real
 * advantage over a duel: nobody has to match your size to let you play.
 */
export class RoomAdapter {
  readonly escrow: `0x${string}`;
  readonly publicClient: PublicClient;
  private readonly pollMs: number;

  constructor(
    private readonly cfg: TradeRushConfig,
    escrowAddress?: `0x${string}`,
    opts: RoomAdapterOptions = {},
  ) {
    const addr = escrowAddress ?? cfg.roomEscrowAddress;
    if (!addr) {
      throw new Error(
        `ROOM_ESCROW_ADDRESS is not set for ${cfg.network} — deploy RoomEscrow on ` +
        `chain ${cfg.chainId} first and set ROOM_ESCROW_ADDRESS_${cfg.network.toUpperCase()}.`,
      );
    }
    this.escrow = addr;
    this.publicClient = opts.publicClient ?? (createPublicClient({
      chain: cfg.chain, transport: http(cfg.rpcUrl),
    }) as PublicClient);
    this.pollMs = opts.pollMs ?? 3_000;
  }

  // ------------------------------------------------------------------ writes

  /** One-time approval so open/join can pull a stake. */
  async approve(wallet: WalletClient, account: Account, amount: bigint): Promise<TxResult> {
    const hash = await wallet.writeContract({
      chain: this.cfg.chain, account, address: this.cfg.addresses.collateral,
      abi: erc20Abi, functionName: 'approve', args: [this.escrow, amount],
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return { txHash: hash };
  }

  allowance(owner: `0x${string}`): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.cfg.addresses.collateral, abi: erc20Abi,
      functionName: 'allowance', args: [owner, this.escrow],
    });
  }

  /** Open a room and take the first side. */
  async open(
    wallet: WalletClient, account: Account,
    marketId: `0x${string}`, side: Side, stake: bigint,
    entryDeadline: number, marketExpiryTime?: number,
  ): Promise<{ roomId: bigint; txHash: `0x${string}`; link: string }> {
    // Gotcha §8.11 — the escrow enforces this too, but failing here costs nothing.
    if (marketExpiryTime) assertDeadlineSafe(entryDeadline, marketExpiryTime);

    const { request } = await this.publicClient.simulateContract({
      account, address: this.escrow, abi: roomEscrowAbi, functionName: 'open',
      args: [marketId, side === 'up', stake, BigInt(entryDeadline)],
    });
    const txHash = await wallet.writeContract({ ...request, chain: this.cfg.chain });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });

    let roomId: bigint | null = null;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== this.escrow.toLowerCase()) continue;
      try {
        const ev = decodeEventLog({ abi: roomEscrowAbi, data: log.data, topics: log.topics });
        if (ev.eventName === 'Opened') { roomId = (ev.args as { id: bigint }).id; break; }
      } catch { /* not ours */ }
    }
    if (roomId === null) throw new Error(`open() mined in ${txHash} but emitted no Opened event`);

    return { roomId, txHash, link: this.link(roomId) };
  }

  async join(
    wallet: WalletClient, account: Account, roomId: bigint, side: Side, stake: bigint,
  ): Promise<TxResult> {
    const { request } = await this.publicClient.simulateContract({
      account, address: this.escrow, abi: roomEscrowAbi, functionName: 'join',
      args: [roomId, side === 'up', stake],
    });
    const txHash = await wallet.writeContract({ ...request, chain: this.cfg.chain });
    await this.publicClient.waitForTransactionReceipt({ hash: txHash });
    return { txHash };
  }

  /** Take your share of your side's outcome tokens, once entry has closed. */
  async claim(wallet: WalletClient, account: Account, roomId: bigint): Promise<TxResult> {
    const { request } = await this.publicClient.simulateContract({
      account, address: this.escrow, abi: roomEscrowAbi, functionName: 'claim', args: [roomId],
    });
    const txHash = await wallet.writeContract({ ...request, chain: this.cfg.chain });
    await this.publicClient.waitForTransactionReceipt({ hash: txHash });
    return { txHash };
  }

  /** Get your stake back from a room nobody contested. */
  async refund(wallet: WalletClient, account: Account, roomId: bigint): Promise<TxResult> {
    const { request } = await this.publicClient.simulateContract({
      account, address: this.escrow, abi: roomEscrowAbi, functionName: 'refund', args: [roomId],
    });
    const txHash = await wallet.writeContract({ ...request, chain: this.cfg.chain });
    await this.publicClient.waitForTransactionReceipt({ hash: txHash });
    return { txHash };
  }

  // ------------------------------------------------------------------- reads

  async count(): Promise<number> {
    const next = await this.publicClient.readContract({
      address: this.escrow, abi: roomEscrowAbi, functionName: 'nextId',
    }) as bigint;
    return Number(next) - 1;
  }

  async read(roomId: bigint): Promise<Room | null> {
    const raw = await this.publicClient.readContract({
      address: this.escrow, abi: roomEscrowAbi, functionName: 'rooms', args: [roomId],
    }) as readonly [`0x${string}`, bigint, bigint, bigint, boolean, boolean];

    const [marketId, entryDeadline, totalUp, totalDown, exists, unwound] = raw;
    if (!exists) return null;

    return {
      id: roomId,
      marketId,
      entryDeadline: Number(entryDeadline),
      totalUp,
      totalDown,
      pot: totalUp + totalDown,
      closed: Date.now() / 1000 >= Number(entryDeadline),
      oneSided: totalUp === 0n || totalDown === 0n,
      unwound,
    };
  }

  /** What one player put in, and what they can take out. */
  async seat(roomId: bigint, who: `0x${string}`): Promise<Seat> {
    const [up, down, share, settled] = await Promise.all([
      this.publicClient.readContract({ address: this.escrow, abi: roomEscrowAbi, functionName: 'upOf', args: [roomId, who] }) as Promise<bigint>,
      this.publicClient.readContract({ address: this.escrow, abi: roomEscrowAbi, functionName: 'downOf', args: [roomId, who] }) as Promise<bigint>,
      this.publicClient.readContract({ address: this.escrow, abi: roomEscrowAbi, functionName: 'shareOf', args: [roomId, who] }) as Promise<readonly [bigint, bigint]>,
      this.publicClient.readContract({ address: this.escrow, abi: roomEscrowAbi, functionName: 'settled', args: [roomId, who] }) as Promise<boolean>,
    ]);
    return { up, down, shareUp: share[0], shareDown: share[1], settled };
  }

  /**
   * Every room this address is in, newest first.
   *
   * A linear scan: the escrow keeps no per-player index, and adding one would
   * charge every opener gas to serve a screen. Reads are free.
   */
  async listFor(who: `0x${string}`, limit = 40): Promise<{ room: Room; seat: Seat }[]> {
    const count = await this.count();
    if (count <= 0) return [];
    const ids: bigint[] = [];
    for (let id = count; id >= 1 && ids.length < limit; id--) ids.push(BigInt(id));

    const rows = await Promise.all(ids.map(async (id) => {
      const room = await this.read(id).catch(() => null);
      if (!room) return null;
      const seat = await this.seat(id, who).catch(() => null);
      if (!seat || (seat.up === 0n && seat.down === 0n)) return null;
      return { room, seat };
    }));
    return rows.filter((r): r is { room: Room; seat: Seat } => r !== null);
  }

  /** Polls rooms(id) every few seconds. Polling is the source of truth; nothing
   *  here is allowed to strand someone in a lobby because a socket dropped. */
  watch(roomId: bigint, onChange: (room: Room | null) => void): () => void {
    let stopped = false;
    let last = '';
    const poll = async () => {
      try {
        const room = await this.read(roomId);
        const key = room ? `${room.totalUp}:${room.totalDown}:${room.closed}:${room.unwound}` : 'null';
        if (stopped || key === last) return;
        last = key;
        onChange(room ? { ...room } : null);
      } catch { /* keep polling; never throw from watch */ }
    };
    void poll();
    const timer = setInterval(() => void poll(), this.pollMs);
    return () => { stopped = true; clearInterval(timer); };
  }

  /** §5.3 — state lives on-chain, so the link carries no secrets. */
  link(roomId: bigint | number | string, chainId: number = this.cfg.chainId): string {
    return `/r/${chainId}/${this.escrow}/${roomId}`;
  }
}

/** Parses /r/<chainId>/<escrow>/<roomId> back out of a URL path. */
export function parseRoomLink(path: string): { chainId: number; escrow: `0x${string}`; roomId: bigint } | null {
  const m = /^\/r\/(\d+)\/(0x[0-9a-fA-F]{40})\/(\d+)$/.exec(path.split('?')[0] ?? '');
  if (!m) return null;
  return { chainId: Number(m[1]), escrow: m[2] as `0x${string}`, roomId: BigInt(m[3]!) };
}
