import type { MarketDef, Race } from './types';

/**
 * The races on the demo card. Two assets x three window lengths.
 *
 * The minute is here for the ending. A window has to CLOSE before the result
 * card, the count-up and the streak can be seen at all, and the venue's own
 * short series come and go — when it is running hour and day markets there is
 * nothing to watch settle. At the demo's default twenty times real time a
 * minute lands in about three seconds; slowed to ×1 it is a real minute, which
 * is long enough for the run to be worth something and short enough to sit
 * through twice.
 *
 * It is NOT the dial the demo opens on. The console lands on the first entry
 * here, and a window that settles every three seconds gives nobody time to
 * read the result it just drew — the minute is a thing to tune TO.
 */
export const MARKETS: MarketDef[] = [
  { asset: 'BTC', interval: '15M', sec: 900, base: 78000 },
  { asset: 'BTC', interval: '1M', sec: 60, base: 78000 },
  { asset: 'BTC', interval: '1H', sec: 3600, base: 78000 },
  { asset: 'ETH', interval: '15M', sec: 900, base: 3100 },
  { asset: 'ETH', interval: '1M', sec: 60, base: 3100 },
  { asset: 'ETH', interval: '1H', sec: 3600, base: 3100 },
];

/** Staggered starts, so the four races are never in step. */
/** Where each dial starts inside its own window, so switching to one lands
 *  mid-race rather than on a suspiciously fresh start. One per dial. */
const STAGGER = [0, 12, 900, 300, 34, 1800];

/** Trail length. Long enough to fill the canvas, short enough to stay cheap. */
export const HIST_MAX = 170;

export function newRace(marketIndex: number, elapsed = 0): Race {
  const m = MARKETS[marketIndex]!;
  const strike = m.base * (1 + (Math.random() - 0.5) * 0.004);
  const spot = strike + (Math.random() - 0.5) * m.base * 0.0006;
  return {
    marketId: '', symbol: m.asset,
    win: m.sec, t: elapsed, openTime: 0, strike, spot, upP: 0.5,
    // The demo has no book. A spread of one point either side of the mid is
    // enough for the exit price to be visibly worse than the quote, which is the
    // fact the ticket has to teach.
    bestBid: 0.49, bestAsk: 0.51,
    hist: [strike], histStartT: elapsed,
    pos: null, phase: 'trade', wasDanger: false, settled: [],
  };
}

export function initialRaces(): Race[] {
  return MARKETS.map((_, i) => newRace(i, STAGGER[i]));
}

/** Implied UP probability.
 *
 *  Two inputs: how far spot sits from strike, and how much room is left. Early in
 *  a window a big move barely moves the odds — there is time to come back. Late,
 *  the same move nearly settles it. That is the `1 - room * 0.72` term. */
export function impliedUp(spot: number, strike: number, room: number, jitter = 0): number {
  const lean = Math.max(-1, Math.min(1, (spot - strike) / (strike * 0.0016)));
  return Math.max(0.01, Math.min(0.99, 0.5 + lean * 0.5 * (1 - room * 0.72) + jitter));
}

/** One simulation step for a race nobody is watching. Cheap on purpose: no trail,
 *  no odds jitter. When its window ends it silently restarts. */
export function tickBackground(race: Race, index: number, speed: number): void {
  if (race.phase !== 'trade') return;
  race.t += speed;
  const room = Math.max(0.02, (race.win - race.t) / race.win);
  race.spot += (Math.random() - 0.49) * race.strike * 0.0006 * speed * 0.3;
  race.upP = impliedUp(race.spot, race.strike, room);
  quote(race);
  if (race.t >= race.win) Object.assign(race, newRace(index, 0));
}

/** One price step for the race being watched. Volatility ramps hard in the last
 *  15% of the window — that is what makes the endgame feel dangerous. */
export function tickPrice(race: Race, speed: number): void {
  const progress = race.t / race.win;
  const vol = race.strike * 0.00022
    * (1 + 2.2 * Math.max(0, (progress - 0.85) / 0.15))
    * Math.sqrt(speed);
  race.spot += (Math.random() - 0.49) * vol;
  race.hist.push(race.spot);
  if (race.hist.length > HIST_MAX) race.hist.shift();

  const room = Math.max(0.02, (race.win - race.t) / race.win);
  race.upP = impliedUp(race.spot, race.strike, room, (Math.random() - 0.5) * 0.05 * room);
  quote(race);
}

/** The demo's order book: a spread around the mid that WIDENS as the price gets
 *  lopsided, because that is what a real book does — nobody quotes tight on a
 *  side that is nearly settled. It is what makes an exit cost something. */
function quote(race: Race): void {
  const edge = 0.012 + 0.05 * Math.abs(race.upP - 0.5);
  race.bestBid = Math.max(0.01, race.upP - edge);
  race.bestAsk = Math.min(0.99, race.upP + edge);
}

/** 900 -> "15M", 3600 -> "1H", 86400 -> "24H". The venue runs intervals the
 *  prototype's fixed 15M/1H tuner never anticipated. */
export function intervalLabel(sec: number): string {
  if (!sec) return '—';
  if (sec < 60) return `${sec}S`;
  if (sec < 3600) return `${Math.round(sec / 60)}M`;
  // Past two days an hour count stops being a length anyone can feel: the
  // venue's 3,888,000s window read "1080H", which is arithmetically right and
  // useless. Days are the unit a person holds a 45-day position in.
  if (sec < 172_800) return `${Math.round(sec / 3600)}H`;
  return `${Math.round(sec / 86_400)}D`;
}

/** 8026 -> "2h 14m". A screen that says "entry shuts in 8026s" is making the
 *  reader do arithmetic to find out whether they have time. */
export function human(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (s < 86400) return m ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(s / 86400);
  return `${d}d ${Math.floor((s % 86400) / 3600)}h`;
}

export const money = (n: number): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const price = (n: number): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function mmss(seconds: number): string {
  const m = Math.floor(seconds / 60), s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function utcLabel(secondsFromNow: number): string {
  const d = new Date(Date.now() + secondsFromNow * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
}
