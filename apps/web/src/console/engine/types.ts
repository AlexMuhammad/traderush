import type { MarketStatus } from '@bullrun/sdk';

export type Side = 'up' | 'down';
export type { MarketStatus };

/** A window runs `trade` -> `lock` (bets closed, price still moving) -> `done`. */
export type Phase = 'trade' | 'lock' | 'done';

export interface Position {
  side: Side;
  /** Shares held. Each pays 1 if the side wins. */
  n: number;
  /** What was paid for them. */
  cost: number;
}

export interface SettledWindow {
  /** Closing price. */
  p: number;
  /** Which side took it. */
  w: Side;
}

/** One of the four races. Only the tuned-in race is fully simulated and drawn;
 *  the other three tick in the background so switching to one lands mid-window
 *  rather than on a suspiciously fresh start. */
/** One reading of a live market, as the console needs it. The engine keeps its
 *  own `hist`, `pos` and cinematic state; everything here comes from the chain. */
export interface FeedSlot {
  /** bytes32. A CHANGE here means the window rolled and a new one opened. */
  marketId: string;
  symbol: string;
  intervalSec: number;
  strike: number;
  spot: number;
  upP: number;
  openTime: number;
  expiryTime: number;
  status: MarketStatus;
}

/** Where the console's numbers come from. Two implementations: the simulation
 *  that ships with demo mode, and the indexer. Nothing else in the engine knows
 *  which one it is looking at. */
export interface MarketFeed {
  /** Fires whenever the slots change. Returns an unsubscribe. */
  subscribe(onSlots: (slots: FeedSlot[]) => void): () => void;
  /** True when these are real markets — the UI says so. */
  readonly live: boolean;
}

export interface Race {
  /** bytes32 of the live market, or '' in demo mode. */
  marketId: string;
  symbol: string;
  /** Window length in seconds. */
  win: number;
  /** Seconds elapsed in this window. Live, this is DERIVED from `openTime` on
   *  every clock tick — deriving it only when the feed polls made the countdown
   *  jump three seconds at a time instead of ticking. */
  t: number;
  /** Unix seconds the window opened. 0 in demo mode, which counts its own time. */
  openTime: number;
  /** The window's opening price. Above it the bulls hold; below it the bears. */
  strike: number;
  spot: number;
  /** Implied probability of UP, 0..1. downP is always 1 - upP. */
  upP: number;
  /** Price trail, oldest first. Capped so the canvas never walks a long array. */
  hist: number[];
  pos: Position | null;
  phase: Phase;
  /** Last known "am I in enemy territory", so a crossing can be detected. */
  wasDanger: boolean;
  settled: SettledWindow[];
}

export interface MarketDef {
  asset: 'BTC' | 'ETH';
  interval: '15M' | '1H';
  /** Window length in seconds. */
  sec: number;
  base: number;
}

export interface Particle {
  x: number; y: number; vx: number; vy: number;
  /** 1 -> 0; the particle is removed at 0. */
  life: number;
  /** An "r,g,b" triple, ready for rgb(). */
  col: string;
  sz: number;
}

export interface Ring { x: number; y: number; r: number; a: number; col: string }
export interface Slash { x: number; y: number; t: number }

/** A finish-line cinematic. `gore` and `claw` are losses; `stand` is a win. */
export interface Attack {
  type: 'gore' | 'claw' | 'stand';
  /** Which animal is involved — only meaningful for `stand`. */
  beast?: 'bull' | 'bear';
  /** Elapsed ms, driven by the render loop. */
  t: number;
  x: number; y: number;
}

export interface Outcome { win: boolean; txt: string; sub: string }

/** What the React chrome renders. A fresh object is published on every change;
 *  the canvas is never re-rendered by React, only this. */
export interface ConsoleSnapshot {
  asset: string;
  /** Human interval for the CURRENT dial: 15M, 1H, 24H… The venue runs
   *  intervals the prototype's fixed pair never anticipated. */
  interval: string;
  /** Every asset with a live market, in dial order. */
  assets: string[];
  /** Every interval available for the CURRENT asset, shortest first. The venue
   *  runs five; a fixed pair of buttons could only ever reach two. */
  intervals: string[];
  assetIndex: number;
  intervalIndex: number;
  /** Index into the four races, for the tuner segments. */
  raceIndex: number;
  riders: string;
  /** False in demo mode — the readouts are simulated and must say so. */
  live: boolean;
  expiryLabel: string;

  strike: number;
  spot: number;
  delta: number;
  bullish: boolean;
  upP: number;

  phase: Phase;
  statusText: string;
  clock: string;
  /** 0..1 through the window. */
  progress: number;
  /** True in the last 10% — the panel glows and the bar turns amber. */
  urgent: boolean;
  /** True when the panel should run hot: near expiry, or being hunted. */
  hot: boolean;

  pos: Position | null;
  /** Live mark-to-market of the open position. */
  pnl: number;
  /** What bailing out would return right now. */
  bailValue: number;
  /** The line under the ticket. Becomes the settlement note once resolved. */
  ticketNote: string;
  ticketSide: string;
  /** Label on the exit key. Becomes Paid/Lost once the window has resolved. */
  bailLabel: string;
  /** The exit key only works while trading. */
  canBail: boolean;
  /** Right-hand readout: HOME GROUND / IN ITS TERRITORY / HORNS OUT / NO STAKE. */
  ground: string;

  balance: number;
  stakePct: number;
  cost: number;
  costNote: string;
  /** No liquidity on that side — the key is dead. */
  dryUp: boolean;
  dryDown: boolean;

  speed: number;
}
