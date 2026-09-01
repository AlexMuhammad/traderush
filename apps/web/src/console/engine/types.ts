import type { MarketStatus } from '@traderush/sdk';

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
  /** Top of book as probabilities, or null when that side is empty. The mid is
   *  what nobody trades at; these are what an exit actually gets. */
  bestBid: number | null;
  bestAsk: number | null;
  openTime: number;
  expiryTime: number;
  status: MarketStatus;
  /** The underlying's ticks inside this window, oldest first, `t` in seconds
   *  from the open. Lets a dial be drawn from the window's start rather than
   *  from whenever the page happened to load. */
  history?: { t: number; price: number }[];
}

/** Where the console's numbers come from. Two implementations: the simulation
 *  that ships with demo mode, and the indexer. Nothing else in the engine knows
 *  which one it is looking at. */
export interface MarketFeed {
  /** Fires whenever the slots change. Returns an unsubscribe. */
  subscribe(onSlots: (slots: FeedSlot[]) => void): () => void;
  /** True when these are real markets — the UI says so. */
  readonly live: boolean;
  /** Candles covering a whole window, for dials the tick tape cannot reach.
   *  Out of band on purpose: it must never sit between a load and a frame. */
  backfill?(slot: FeedSlot): Promise<{ t: number; price: number }[]>;
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
  /** Top of book, carried so an exit can be priced at what it would fetch
   *  rather than at the mid. Null means that side of the book is empty. */
  bestBid: number | null;
  bestAsk: number | null;
  /** Price trail, oldest first. Capped so the canvas never walks a long array. */
  hist: number[];
  /** Seconds into the window when the FIRST sample was taken. Joining a 4h
   *  market at minute ten means we have watched ten minutes, not four hours,
   *  and the trail must not claim otherwise. */
  histStartT: number;
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

/** A line of the payout breakdown, revealed one at a time after the total
 *  lands. Three small arrivals beat one large one: each is its own moment. */
export interface TallyItem {
  label: string;
  value: string;
  tone: 'up' | 'dn' | 'gold';
}

/**
 * The settlement count-up.
 *
 * A result that arrives as one finished number tells you what happened and
 * nothing about why. This is the same arithmetic the contract did — what you
 * staked, what the book thought of your side, what that pays — laid out so it
 * can be revealed a beat at a time.
 */
export interface Tally {
  win: boolean;
  /** What you put in. */
  stake: string;
  /** The book odds actually taken, as a percentage. */
  oddsPct: number;
  /** What the window does to the stake. 0 on a loss — a loss is not a smaller
   *  multiple, it is the multiple not applying. */
  mult: number;
  /** What the count-up lands on. On a loss it DRAINS from the stake to this. */
  total: number;
  /** Where that number came from. Empty on a loss. */
  items: TallyItem[];
  /** Signed, everything included. */
  net: number;
  /** Consecutive wins including this one. 0 when this broke a streak. */
  streak: number;
  /** Loss only: how far the close missed the strike by, already formatted. */
  missedBy: string;
  /** Loss only, and true only when it was close enough to hurt. */
  nearMiss: boolean;
}

export interface Outcome {
  win: boolean;
  txt: string;
  sub: string;
  /** Null when you sat the window out — there is no arithmetic to show. */
  tally: Tally | null;
  /** Which animal took the window. The result text is coloured by THIS, not by
   *  whether you won: green is the bull and red is the bear everywhere else on
   *  the machine, and GORED is the bull's word even when it is your loss. */
  winner: Side;
}

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

  /** Label on the exit key. Becomes Paid/Lost once the window has resolved. */
  /** The side held on the window being watched, from a room or duel. The call
   *  keys light from this — the console no longer holds a position of its own. */
  watchSide: Side | null;
  /** Right-hand readout: HOME GROUND / IN ITS TERRITORY / HORNS OUT / NO STAKE. */
  ground: string;

  /** No liquidity on that side — the key is dead. */
  dryUp: boolean;
  dryDown: boolean;

  speed: number;
}
