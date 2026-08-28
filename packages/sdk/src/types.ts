export type MarketStatus = 'Listed' | 'Trading' | 'Locked' | 'Settling' | 'Resolved' | 'Voided';

/// On-chain MarketStatus enum. The PRD listed 3 as unused; the bot kit's
/// ec-core/markets.ts shows it is `Settling`, so a market CAN sit in a state that
/// is neither tradeable nor yet redeemable. Treating 3 as unknown would have
/// rendered a settling market as `Listed`.
export const STATUS_BY_CODE: Record<number, MarketStatus> = {
  0: 'Listed',
  1: 'Trading',
  2: 'Locked',
  3: 'Settling',
  4: 'Resolved',
  5: 'Voided',
};

export const CODE_BY_STATUS: Record<MarketStatus, number> = {
  Listed: 0, Trading: 1, Locked: 2, Settling: 3, Resolved: 4, Voided: 5,
};

export type Side = 'up' | 'down';

/// The state contract between the SDK and every front end, present and future (§5.1).
/// The game console will be rendered from exactly this object.
export interface MarketState {
  /** ALWAYS key state by this, never by pool address (gotcha §8.6). */
  marketId: string;
  /** Typed field `asset` — never regex the question text (gotcha §8.9). */
  symbol: string;
  /** Typed field — never derived from the question wording (gotcha §8.9). */
  intervalSec: number;
  /** The window's opening price. */
  strike: number;
  spot: number;
  /** 0..1, reads as implied probability. downPrice is always 1 - upPrice. */
  upPrice: number;
  status: MarketStatus;
  openTime: number;
  expiryTime: number;
  upLiquid: boolean;
  downLiquid: boolean;
  oracleQuestionId: string | null;
  /** e.g. 'disconnected'. watch() never throws; it reports here instead. */
  error?: string;
}

export interface MarketSummary extends MarketState {
  /** Present for book trading only. Duels never need it — and pools are recycled
   *  across windows, so it must never be used as a state key (gotcha §8.6). */
  poolAddress: string | null;
}

/** Venue addresses, re-fetched at runtime from GET /v0/markets (§2). Never hard-coded. */
export interface VenueAddresses {
  collateral: `0x${string}`;
  module: `0x${string}`;
  outcomeToken: `0x${string}`;
}

export type DuelStatus = 'None' | 'Open' | 'Matched' | 'Cancelled';

export interface Duel {
  id: bigint;
  challenger: `0x${string}`;
  opponent: `0x${string}`;
  marketId: `0x${string}`;
  /** Per side, in collateral base units. Pot is 2 * stake. */
  stake: bigint;
  acceptDeadline: number;
  challengerUp: boolean;
  status: DuelStatus;
}

/** What S5/S6 render. Derived, never stored. */
export interface DuelView extends Duel {
  pot: bigint;
  expired: boolean;
}

export interface Position {
  marketId: string;
  side: Side;
  size: bigint;
  txHash: `0x${string}`;
}

export interface TxResult {
  txHash: `0x${string}`;
}
