import { Audio } from './audio';
import { newBeastState, type BeastState } from './beasts';
import { burst } from './fx';
import {
  MARKETS, HIST_MAX, initialRaces, newRace, tickBackground, tickPrice,
  money, mmss, utcLabel, intervalLabel,
} from './market';
import { renderScene, type Scene } from './render';
import {
  T_STAKE, T_ODDS, T_MULT, T_SLAM, T_COUNT, tallyItemAt, tallyEndAt,
} from './cinematics';
import type {
  Attack, ConsoleSnapshot, FeedSlot, MarketFeed, Outcome, Particle, Position, Race, Ring,
  Side, Slash, Tally, TallyItem,
} from './types';

/**
 * Shortest window the console will OPEN on.
 *
 * Every interval stays reachable on the dials; this only decides where the
 * first press happens. Measured on live testnet, a sixty second book filled
 * three orders in six while five minutes filled five in five.
 */
const OPENING_MIN_WINDOW = 300;

/** Seconds between the window closing and the result landing. */
const LOCK_SECONDS = 2.2;
/** Segments in the progress bar. Fixed, so 15m and 1h windows look alike. */
export const PROGRESS_SEGMENTS = 48;
/** Demo speeds, cycled by the footer. 1 is real time. */
const SPEEDS = [20, 5, 1];
/** Below this implied probability a side is treated as having no liquidity. */
const DRY = 0.04;
/**
 * What the demo's book charges to take a position back.
 *
 * Live, an exit fetches the resting BID rather than the mid, and the gap is
 * most of what makes changing your mind cost something. The demo has no book to
 * quote, so the same lesson is charged explicitly: sell back and you get the
 * side's own price less this. A frictionless demo would teach the wrong thing
 * about the product it is demonstrating.
 */
const PAPER_SPREAD = 0.06;

type Listener = (s: ConsoleSnapshot) => void;

/**
 * Owns every piece of console state and drives the canvas.
 *
 * React never renders the canvas. It subscribes to `ConsoleSnapshot` for the
 * chrome and calls the action methods; everything else happens in here, at
 * animation-frame and interval rates that React should not be involved in.
 */
export class Engine implements Scene {
  // --- scene state (read by the renderer) ----------------------------------
  frame = 0;
  /** Demo starts at five times real time, not twenty.
   *
   *  Twenty makes a fifteen minute window land in forty-five seconds, which
   *  sounds convenient and plays badly: the animals barely move, and on the
   *  minute dial a whole window is over in three seconds — the result card is
   *  drawn and gone before it can be read. Five is still a demo and still
   *  finishes, and the footer says which it is. */
  speed = SPEEDS[1]!;
  readonly audio = new Audio();

  particles: Particle[] = [];
  rings: Ring[] = [];
  slashes: Slash[] = [];
  attack: Attack | null = null;
  outcome: Outcome | null = null;
  /** ms since the result card appeared. The renderer advances it. */
  outcomeT = 0;
  /** Consecutive wins this session. Survives the window rolling — it is the one
   *  number on the machine that is only ever lost by playing. */
  private winStreak = 0;

  shake = 0;
  flash = 0;
  flashCol = '255,58,24';

  bullX = 0; bullY = 0; bearX = 0; bearY = 0;
  bullA = 1; bearA = 1;
  beasts: { bull: BeastState; bear: BeastState } = {
    bull: newBeastState(900),
    bear: newBeastState(1100),
  };

  hoofT = 0; lungeT = 0; lunge = 0; borderT = 0;
  /** Owned by the renderer: the eased clock and vertical scale. Zero means
   *  "unset", which is the renderer's cue to snap rather than glide. */
  tView = 0; scaleLo = 0; scaleHi = 0; headP = 0; stridePhase = 0;

  /**
   * The side you hold in a DUEL or a ROOM, for the scene to hunt you on.
   *
   * Deliberately not `race.pos`: that is the paper game's position and it is
   * what settlement pays out against. A room's stake is real money held by an
   * escrow, and writing it into `pos` would have the console credit a balance
   * for it. This says only "which half of the glass is his", which is all the
   * animals need to know.
   */
  watchSide: Side | null = null;

  /**
   * What the held side is worth, when the screen showing it knows.
   *
   * A room knows both halves — what went in, and what the split would pay if
   * this side takes it — so the settlement count-up can be built from real
   * money. Armed from the call keys there is no room yet and this stays null;
   * the window then ends on the plain card instead of the arithmetic.
   */
  private watchEcon: { stake: number; payoutIfWon: number } | null = null;

  /**
   * Take a side on paper. Demo only.
   *
   * The console owns no position when it is live — the book and the escrows do,
   * and writing one here would have the machine credit a balance for money it
   * is not holding. In demo there is no chain to hold anything, so the paper
   * position IS the position, and it is what the settlement card counts.
   *
   * Priced off the same implied probability the keys already show, so what the
   * card pays back reconciles with what the key promised. Returns false when
   * the window will not take it, which is what the caller shows as a blocker.
   */
  takePaper(side: Side, stake: number): boolean {
    const R = this.race;
    if (this.isLive || R.phase !== 'trade' || !(stake > 0)) return false;
    const p = side === 'up' ? R.upP : 1 - R.upP;
    if (!(p > 0.01) || !(p < 0.99)) return false;
    // Changing your mind is free here, and it has to be. A demo exists to be
    // poked at; trapping someone on the first key they pressed for the rest of
    // the window teaches them the product is unforgiving, which is the opposite
    // of what it is for. The old stake comes back and the new one goes on.
    if (R.pos) this.balance += R.pos.cost;
    R.pos = { side, n: stake / p, cost: stake };
    this.balance -= stake;
    // The scene hunts whoever `watchSide` names, and the keys light from the
    // same place. Leaving it null meant a demo position you could see in the
    // readout and nowhere else: the animals grazed through it and the key you
    // had just pressed stayed dark. A paper side IS which half of the glass is
    // his, which is all either of them was ever asking.
    this.watchSide = side;
    this.audio.tone(880, 0.06, 'square', 0.06);
    this.publish();
    return true;
  }

  /**
   * What the paper position would fetch if sold back right now, or null when
   * there is nothing to sell or the window has stopped trading. Demo only.
   */
  get paperExit(): number | null {
    const R = this.race;
    if (this.isLive || !R.pos || R.phase !== 'trade') return null;
    const p = R.pos.side === 'up' ? R.upP : 1 - R.upP;
    const px = p * (1 - PAPER_SPREAD);
    return px > 0 ? R.pos.n * px : null;
  }

  /**
   * Sell the paper position back into the demo's book.
   *
   * Returns the proceeds, or null when there was nothing to sell. The side goes
   * with it: the scene stops hunting, the key goes dark, and the window can be
   * taken again from scratch — which is the whole point of being able to leave.
   */
  exitPaper(): number | null {
    const v = this.paperExit;
    if (v === null) return null;
    this.balance += v;
    this.race.pos = null;
    this.watchSide = null;
    this.audio.tone(392, 0.09, 'square', 0.06);
    this.publish();
    return v;
  }

  /** Whether a paper side can be taken right now. Demo only; false when live.
   *  Holding one already is not a reason to refuse — see `takePaper`. */
  get canTakePaper(): boolean {
    return !this.isLive && this.race.phase === 'trade';
  }

  /** Tell the scene which side is held here. Null goes back to a spectator. */
  setWatchSide(side: Side | null, econ: { stake: number; payoutIfWon: number } | null = null): void {
    const same = this.watchSide === side
      && this.watchEcon?.stake === econ?.stake
      && this.watchEcon?.payoutIfWon === econ?.payoutIfWon;
    if (same) return;
    this.watchSide = side;
    this.watchEcon = econ;
    this.publish();
  }
  phaseName = 'OPEN';
  chased = false;
  rising = true;
  /** Read by the renderer, which must not draw the seeded simulation as if it
   *  were a market. */
  get live(): boolean { return this.isLive; }

  // --- console state -------------------------------------------------------
  private races: Race[] = initialRaces();
  private raceIndex = 0;
  /**
   * Whether the opening dial has been settled.
   *
   * The feed lists windows shortest first, which is right for stepping through
   * them and wrong for the one the console opens on: a sixty second book turns
   * over faster than a transaction confirms, so roughly a third of orders there
   * come back unfilled. That is the first key anyone presses.
   *
   * So the opening choice lands on the shortest window whose book sits still.
   * Once — an explicit tune must win, and this must never yank a dial out from
   * under someone.
   */
  private openingChosen = false;
  private balance = 2847;
  private stakePct = 25;
  /** Overrides `phaseName` between the horn and the next window. */
  private statusOverride: string | null = null;
  private riders = '';
  private expiryLabel = '';
  private lastBeepAt = -1;

  /** Where the numbers come from. Undefined = the built-in simulation. */
  private readonly feed?: MarketFeed;
  private unsubscribeFeed: (() => void) | null = null;

  /**
   * True from the moment a window locks until its result has had its moment.
   *
   * The venue opens the next window within seconds of closing the last one, and
   * the feed reports it on the next poll. Applying that roll immediately wiped
   * the scene — including the GORED / MAULED / HELD THE LINE card — before it
   * could be read. The roll waits instead.
   */
  private holdingResult = false;
  /** The next window, parked until the result is done with the screen. */
  private pendingSlot: FeedSlot | null = null;

  private ctx: CanvasRenderingContext2D | null = null;
  private raf = 0;
  private priceTimer = 0;
  private clockTimer = 0;
  private lastFrameAt = performance.now();
  private timeouts: ReturnType<typeof setTimeout>[] = [];
  private listeners = new Set<Listener>();

  constructor(feed?: MarketFeed) { this.feed = feed; }

  get race(): Race { return this.races[this.raceIndex]!; }
  private get isLive(): boolean { return this.feed !== undefined; }

  // ------------------------------------------------------------------ lifecycle

  /** Called every time the game face mounts — the canvas is a new node each time. */
  attachCanvas(canvas: HTMLCanvasElement): void {
    this.ctx = canvas.getContext('2d');
    this.fit();
    /*
     * Re-fit whenever the CANVAS changes size, not just the window.
     *
     * `fit()` used to run exactly twice: once here, and on `window.resize`. A
     * canvas's box can change without either. It happens on an ordinary first
     * load — `attachCanvas` runs on mount, and the CRT settles a frame or two
     * later once fonts and layout land — and the backing store keeps the size
     * it was measured at. The engine then draws a scene sized for the old box
     * into an element that is now bigger, so the chart, the strike line and the
     * animals all sit in the top-left corner with dead black around them, and
     * the game looks broken while every number beside it is correct.
     *
     * It is a resize the window never hears about, so a resize listener cannot
     * catch it. An observer on the element itself can.
     */
    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver(() => this.fit());
    this.resizeObserver.observe(canvas);
  }

  private resizeObserver: ResizeObserver | null = null;
  /** The pixel ratio the backing store was last sized for. */
  private fitDpr = 0;

  /** Sizes the backing store to the CSS box at device pixel ratio. */
  fit = (): void => {
    const c = this.ctx; if (!c) return;
    const r = c.canvas.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.round(r.width * dpr);
    const h = Math.round(r.height * dpr);
    // Assigning to width/height CLEARS the canvas, so only do it when the size
    // actually changed. The observer fires on every layout pass that touches
    // the element, and a wipe on each one is a visible flicker.
    if (w === c.canvas.width && h === c.canvas.height && dpr === this.fitDpr) return;
    c.canvas.width = w;
    c.canvas.height = h;
    this.fitDpr = dpr;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  start(): void {
    if (this.feed) {
      this.unsubscribeFeed = this.feed.subscribe((slots) => this.applySlots(slots));
    } else {
      // Demo mode only: a form guide so the first window is not the first result
      // ever seen. Live, the guide fills from real settlements.
      for (let i = 0; i < 5; i++) {
        this.race.settled.push({ p: 77000 + Math.random() * 2500, w: Math.random() < 0.5 ? 'up' : 'down' });
      }
    }
    this.openWindow();
    addEventListener('resize', this.fit);
    this.priceTimer = window.setInterval(this.tickPrice, 170);
    this.clockTimer = window.setInterval(this.tickClock, 1000);
    this.loop();
  }

  stop(): void {
    this.unsubscribeFeed?.();
    this.unsubscribeFeed = null;
    cancelAnimationFrame(this.raf);
    clearInterval(this.priceTimer);
    clearInterval(this.clockTimer);
    removeEventListener('resize', this.fit);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    for (const t of this.timeouts) clearTimeout(t);
    this.timeouts = [];
    this.listeners.clear();
  }

  /** setTimeout that is cancelled on stop, so a cinematic cannot outlive the page. */
  private later(fn: () => void, ms: number): void {
    this.timeouts.push(setTimeout(fn, ms));
  }

  private loop = (): void => {
    const now = performance.now();
    const dt = Math.min(50, now - this.lastFrameAt);
    this.lastFrameAt = now;
    // The game face unmounts while a duel panel is showing. Painting into a
    // detached canvas is pure waste, and it keeps the price feed's work alive
    // for nothing.
    if (this.ctx && this.ctx.canvas.isConnected) {
      const dpr = Math.min(2, devicePixelRatio || 1);
      /*
       * Re-fit when the PIXEL RATIO changes, not only when the box does.
       *
       * Drag a window from a Retina screen to an external 1x monitor and the
       * element keeps its exact CSS size: no `resize` event, nothing for a
       * ResizeObserver to report. But the backing store is still twice the size
       * it should be, while `renderScene` is now handed dpr 1 and draws at 1:1
       * — so the picture lands in the top-left QUARTER of the canvas with black
       * around it, and stays there. Browser zoom does the same thing.
       *
       * Nothing else in the app can notice this, so the render loop checks it:
       * one comparison a frame, against the ratio the buffer was actually
       * sized for.
       */
      if (dpr !== this.fitDpr) this.fit();
      renderScene(this.ctx, this, dt, dpr);
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  // ------------------------------------------------------------------ subscribe

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => { this.listeners.delete(fn); };
  }

  private publish(): void {
    const s = this.snapshot();
    for (const fn of this.listeners) fn(s);
  }

  snapshot(): ConsoleSnapshot {
    const R = this.race;
    const bullish = R.spot >= R.strike;
    const upP = R.upP;
    const progress = Math.min(1, R.t / R.win);

    // Odds while it is running; the ANSWER once it is not.
    //
    // This used to read the book either way, and the book does not stop quoting
    // when a window closes — so a lost UP leg on a market whose mid had drifted
    // to 94% showed a green +86 profit under a card that said MAULED. A settled
    // contract is worth one or nothing, and nothing the book says changes it.
    const settled = R.phase === 'done';
    const wonIt = R.pos ? R.pos.side === (bullish ? 'up' : 'down') : false;
    const bookOdds = R.pos ? (R.pos.side === 'up' ? upP : 1 - upP) : 0;
    const myOdds = !R.pos ? 0 : settled ? (wonIt ? 1 : 0) : bookOdds;
    // What the position is WORTH at the quote, and what it would actually FETCH.
    // They are not the same number and the difference is the whole point of the
    // exit key: the mid is the price nobody trades at.
    const value = R.pos ? R.pos.n * myOdds : 0;
    const exitPrice = this.exitPrice();
    const exitValue = R.pos && exitPrice !== null ? R.pos.n * exitPrice : null;
    // The side that matters to the scene: armed on the keys, or held in a room
    // or duel. `pos` is gone — the console has no position of its own any more.
    const side = R.pos?.side ?? this.watchSide;
    const danger = side ? (side === 'up' ? !bullish : bullish) : false;
    const sideOdds = side ? (side === 'up' ? upP : 1 - upP) : 0;
    const threat = side ? 1 - sideOdds : 0;
    const urgent = R.phase === 'trade' && progress > 0.90;

    let ground = 'NO SIDE';
    if (side) ground = danger ? (sideOdds < 0.2 ? 'HORNS OUT' : 'IN ITS TERRITORY') : 'HOME GROUND';

    return {
      asset: this.isLive ? R.symbol : MARKETS[this.raceIndex]!.asset,
      interval: this.isLive ? intervalLabel(R.win) : MARKETS[this.raceIndex]!.interval,
      assets: this.assets,
      intervals: this.intervalsForCurrentAsset.map((r) => this.labelOf(r)),
      assetIndex: Math.max(0, this.assets.indexOf(this.assetOf(this.race))),
      intervalIndex: Math.max(0, this.intervalsForCurrentAsset.indexOf(this.race)),
      raceIndex: this.raceIndex,
      riders: this.riders,
      live: this.feed?.live ?? false,
      expiryLabel: this.expiryLabel,

      strike: R.strike,
      spot: R.spot,
      delta: R.spot - R.strike,
      bullish,
      upP,

      phase: R.phase,
      statusText: this.statusOverride ?? this.phaseName + (danger ? ' · CHASED' : ''),
      clock: mmss(Math.max(0, R.win - R.t)),
      progress,
      urgent,
      hot: urgent || (danger && threat > 0.72),

      watchSide: this.watchSide,
      ground,

      dryUp: upP <= DRY,
      dryDown: upP >= 1 - DRY,

      speed: this.speed,
    };
  }

  /** Before settlement this is the terms; after it, what actually happened.
   *
   *  Points, not USDso. The console's keys stake paper — saying USDso was wrong
   *  twice over: it is not the collateral on testnet, and it implied the keys
   *  spend money they do not. */
  private ticketNote(): string {
    const R = this.race;
    if (!R.pos) return '—';
    // The unit, every time. It was on the footer and on the result card but not
    // here, so the one line that says what you stand to win read as money — and
    // on a screen where every other number IS money, an unlabelled one is taken
    // for the same thing.
    if (R.phase !== 'done') {
      return `${money(R.pos.cost)} to win ${money(R.pos.n)} pts`;
    }
    const won = R.pos.side === (R.spot >= R.strike ? 'up' : 'down');
    return won
      ? `${money(R.pos.cost)} returned ${money(R.pos.n)} pts`
      : `${money(R.pos.cost)} pts lost`;
  }

  /**
   * What one share of the held side would sell for, right now, into the book.
   *
   * There is ONE book and it is quoted on UP, so the two sides exit through
   * opposite ends of it:
   *   selling UP   → hit the bid          → bestBid
   *   selling DOWN → close by buying UP   → 1 - bestAsk
   *
   * Null when that end is empty. Pricing an exit at the mid — which is what this
   * did — quotes a number no counterparty has offered, and on a thin book the
   * difference is most of the position.
   */
  private exitPrice(): number | null {
    const R = this.race;
    if (!R.pos) return null;
    if (R.pos.side === 'up') return R.bestBid;
    return R.bestAsk === null ? null : 1 - R.bestAsk;
  }

  private bailLabel(value: number | null): string {
    const R = this.race;
    if (!R.pos) return 'Bail out';
    if (R.phase !== 'done') {
      // Said as the reason, not as a dead key with a price on it.
      return value === null ? 'No bid — cannot sell' : `Bail out · ${money(value)}`;
    }
    return R.pos.side === (R.spot >= R.strike ? 'up' : 'down') ? 'Paid' : 'Lost';
  }

  // ------------------------------------------------------------------- windows

  private openWindow(): void {
    // Live, the venue opens windows; the console only follows them. Rolling one
    // ourselves would throw away the market we are actually watching.
    if (!this.isLive) {
      const carried = this.race.settled;
      this.races[this.raceIndex] = { ...newRace(this.raceIndex, 0), settled: carried };
    }
    this.resetScene();
    this.labelWindow();
    this.statusOverride = 'OPEN';
    this.publish();
  }

  /**
   * Ask for candles when the tick tape does not reach the window's open.
   *
   * The tape holds a few minutes: enough to draw a 1m or 5m window whole, and
   * nowhere near an hour. Without this a long dial drew a stub floating in the
   * middle of the glass, which reads as broken rather than as honest.
   *
   * Fired and forgotten. The answer is applied only if that dial is still on
   * the same market, so a slow reply cannot overwrite a window that has since
   * rolled or a dial the viewer has since left.
   */
  private requestBackfill(slot: FeedSlot): void {
    if (!this.feed?.backfill) return;
    const elapsed = Math.max(0, Math.floor(Date.now() / 1000) - slot.openTime);
    const covered = slot.history?.length ? elapsed - slot.history[0]!.t : 0;
    // Good enough already: the tape reaches most of what has happened.
    if (elapsed < 90 || covered >= elapsed * 0.8) return;

    void this.feed.backfill(slot).then((points) => {
      if (points.length < 2) return;
      // Found by market, not by the index it sat at when this was asked for.
      // The dials are rebuilt whenever the venue's list changes, so a position
      // captured a network round-trip ago names a different window by the time
      // the tape lands — and the answer would be dropped, or worse, kept.
      const race = this.races.find((r) => r.marketId === slot.marketId);
      if (!race) return;
      const trimmed = points.length > HIST_MAX ? points.slice(points.length - HIST_MAX) : points;
      race.hist = trimmed.map((p) => p.price);
      race.histStartT = trimmed[0]!.t;
      this.publish();
    }).catch(() => { /* the tape's partial trail stands */ });
  }

  /** A slot's trail: the underlying's real ticks inside the window when the
   *  feed has them, otherwise the single reading we do have. Capped so a long
   *  tape cannot make the canvas walk a huge array. */
  private trailFor(slot: FeedSlot, elapsed: number): { hist: number[]; histStartT: number } {
    const h = slot.history ?? [];
    if (h.length < 2) {
      return { hist: [slot.spot || slot.strike], histStartT: elapsed };
    }
    const trimmed = h.length > HIST_MAX ? h.slice(h.length - HIST_MAX) : h;
    return { hist: trimmed.map((p) => p.price), histStartT: trimmed[0]!.t };
  }

  /** Swap the current dial onto a new window and clear the last one's scene. */
  private rollTo(slot: FeedSlot): void {
    const i = this.raceIndex;
    const now = Math.floor(Date.now() / 1000);
    this.races[i] = {
      marketId: slot.marketId,
      symbol: slot.symbol,
      win: slot.intervalSec || 900,
      t: Math.max(0, now - slot.openTime),
      openTime: slot.openTime,
      strike: slot.strike,
      spot: slot.spot,
      upP: slot.upP,
      bestBid: slot.bestBid,
      bestAsk: slot.bestAsk,
      ...this.trailFor(slot, Math.max(0, now - slot.openTime)),
      pos: null,
      phase: 'trade',
      wasDanger: false,
      settled: this.races[i]?.settled ?? [],
    };
    this.pendingSlot = null;
    this.requestBackfill(slot);
    this.resetScene();
    this.labelWindow();
    this.statusOverride = null;
    this.publish();
  }

  /** The header line and the expiry stamp for whatever is on the dials now. */
  private labelWindow(): void {
    const R = this.race;
    const label = this.isLive
      ? `${R.symbol} ${intervalLabel(R.win)}`
      : `${MARKETS[this.raceIndex]!.asset} ${MARKETS[this.raceIndex]!.interval}`;
    this.riders = `${label} · ${14 + Math.floor(Math.random() * 30)} running`;
    this.expiryLabel = utcLabel(Math.max(0, R.win - R.t));
  }

  private resetScene(): void {
    this.holdingResult = false;
    this.particles = []; this.slashes = []; this.rings = [];
    this.outcome = null; this.outcomeT = 0; this.attack = null;
    this.lunge = 0; this.lastBeepAt = -1;
    // A new window is a different price and a different clock. Easing between
    // two unrelated windows draws a swoop that never happened.
    this.tView = 0; this.scaleLo = 0; this.scaleHi = 0; this.headP = 0;
    this.beasts.bull = newBeastState(900);
    this.beasts.bear = newBeastState(1100);
    this.bullX = this.bullY = this.bearX = this.bearY = 0;
    this.bullA = this.bearA = 1;
    // Nothing is held on a window nobody has taken a side of yet. Left set, the
    // last window's side carried into the next one: the key stayed lit and an
    // animal hunted a position that had already settled. A screen that IS
    // holding something re-asserts it — see MatchScreen.
    this.watchSide = null;
    this.watchEcon = null;
  }

  /**
   * Fold a reading of the live markets onto the four dials.
   *
   * The engine owns `hist`, `pos` and the cinematics; the chain owns everything
   * else. A CHANGED marketId in a slot means that window rolled and a new one
   * opened underneath us — which is a real event, not a glitch, so it resets the
   * scene the same way a simulated roll does.
   */
  /**
   * Put the venue's windows on the dials.
   *
   * Slots are matched to dials by SERIES — the symbol and the window length —
   * and never by position. Both the order and the LENGTH of the feed's answer
   * move as the venue opens and closes windows, and matching by index meant a
   * dial could be handed another asset's window entirely. The worse half was
   * the dials the answer did not reach: iterating the slots only ever touched
   * `0 … slots.length - 1`, so a shorter answer left the tail of `races`
   * holding whatever was there before. On the early polls that tail is still
   * the demo seed — which is how a 15M dial the venue does not run could
   * appear, vanish on the next poll, and, when tuned to, sit on ACQUIRING
   * MARKETS forever: it had no market id to acquire.
   *
   * So the list is rebuilt from the slots each time. A series the venue has
   * stopped running leaves the dials rather than lingering as a ghost.
   */
  private applySlots(slots: FeedSlot[]): void {
    // An empty answer is a poll that failed, not a venue with no markets.
    // Rebuilding from it would clear the dials and leave `race` undefined.
    if (slots.length === 0) return;

    const now = Math.floor(Date.now() / 1000);
    const keyOf = (symbol: string, win: number) => `${symbol}:${win}`;

    // What is on the glass right now, named the one way that survives a rebuild.
    const before = this.races[this.raceIndex];
    const currentKey = before ? keyOf(before.symbol, before.win) : null;

    const existing = new Map<string, Race>();
    for (const r of this.races) existing.set(keyOf(r.symbol, r.win), r);

    let touchedCurrent = false;
    const next: Race[] = [];
    const seen = new Set<string>();
    const backfills: FeedSlot[] = [];

    for (const slot of slots) {
      const win = slot.intervalSec || 900;
      const key = keyOf(slot.symbol, win);
      // One dial per series. A feed that lists a series twice must not put the
      // same race object on the dials twice.
      if (seen.has(key)) continue;
      seen.add(key);

      const prev = existing.get(key);
      const isCurrent = key === currentKey;
      const rolled = !prev || prev.marketId !== slot.marketId;

      if (rolled && isCurrent && prev) {
        // The clock usually notices the expiry first, but the feed can get here
        // in the same second. Do not let a roll skip the settlement of a window
        // someone had a position in.
        if (prev.phase === 'trade' && now >= prev.openTime + prev.win && prev.openTime) {
          prev.phase = 'lock';
          this.holdingResult = true;
          this.statusOverride = 'TIME';
          this.audio.horn();
          this.shake = 8;
          this.later(() => this.resolve(), LOCK_SECONDS * 1000);
        }
        if (this.holdingResult) {
          this.pendingSlot = slot;   // park it; the result owns the screen
          next.push(prev);           // which keeps the window it is settling
          continue;
        }
      }

      if (rolled) {
        next.push({
          marketId: slot.marketId,
          symbol: slot.symbol,
          win,
          t: Math.max(0, now - slot.openTime),
          openTime: slot.openTime,
          strike: slot.strike,
          spot: slot.spot,
          upP: slot.upP,
          bestBid: slot.bestBid,
          bestAsk: slot.bestAsk,
          ...this.trailFor(slot, Math.max(0, now - slot.openTime)),
          pos: null,
          phase: 'trade',
          wasDanger: false,
          // A rolled window keeps the series' form guide.
          settled: prev?.settled ?? [],
        });
        backfills.push(slot);
        if (isCurrent) touchedCurrent = true;
        continue;
      }

      prev.symbol = slot.symbol;
      prev.win = win;
      prev.strike = slot.strike || prev.strike;
      prev.upP = slot.upP || prev.upP;
      // Null is meaningful here — it says that side of the book is EMPTY, which
      // is exactly when an exit is impossible. It must not fall back to the last
      // value the way a price does.
      prev.bestBid = slot.bestBid;
      prev.bestAsk = slot.bestAsk;
      prev.openTime = slot.openTime;
      prev.t = Math.max(0, now - slot.openTime);

      // The tape needs a moment to hydrate, so the first reading of a window
      // often arrives with no history at all. Top it up once it does, rather
      // than leaving that dial stunted for the rest of its window.
      if (prev.hist.length <= 2 && (slot.history?.length ?? 0) > 2) {
        const seeded = this.trailFor(slot, prev.t);
        prev.hist = seeded.hist;
        prev.histStartT = seeded.histStartT;
      }
      if (slot.spot > 0 && slot.spot !== prev.spot) {
        prev.spot = slot.spot;
        prev.hist.push(slot.spot);
        if (prev.hist.length > HIST_MAX) prev.hist.shift();
      }
      next.push(prev);
    }

    // A fixed order, so a dial does not slide under the tuner when the venue
    // answers in a different order than it did on the last poll.
    next.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.win - b.win);
    this.races = next;

    // Stay on the same SERIES across the rebuild — its index has almost
    // certainly moved. A series the venue has stopped running cannot be watched
    // at all, so the tuner falls back to the first dial and the scene is
    // rebuilt for whatever that is.
    const at = currentKey ? next.findIndex((r) => keyOf(r.symbol, r.win) === currentKey) : -1;
    if (at >= 0) this.raceIndex = at;
    else { this.raceIndex = 0; touchedCurrent = true; }

    // Asked for only once the dials are settled, so the tape lands on the list
    // it was asked about.
    for (const slot of backfills) this.requestBackfill(slot);

    // First real slots: open on a window with a book worth pressing.
    if (!this.openingChosen && this.races.some((r) => r.marketId)) {
      this.openingChosen = true;
      const i = this.races.findIndex((r) => r.marketId && r.win >= OPENING_MIN_WINDOW);
      if (i > 0) this.tune(i);
    }

    if (touchedCurrent) {
      this.resetScene();
      this.labelWindow();
      // A rolled window clears whatever the last one left on the status line —
      // otherwise 'WAITING FOR NEXT WINDOW' stays up for the rest of the session
      // while a perfectly live window counts down beneath it.
      this.statusOverride = null;
    }
    this.publish();
  }

  // --------------------------------------------------------------------- ticks

  private tickPrice = (): void => {
    if (this.race.phase !== 'trade') return;
    // Live, the price arrives from the feed; there is nothing to invent. The
    // clock is resynced here too — setInterval drifts, and anchoring only on
    // the 1s tick lets the display skip a second now and then.
    if (this.isLive) this.syncLiveClock();
    else tickPrice(this.race, this.speed);
    this.publish();
  };

  /** Elapsed time against the market's own window, from the wall clock. */
  private syncLiveClock(): void {
    const R = this.race;
    if (!R.openTime) return;
    R.t = Math.max(0, Math.floor(Date.now() / 1000) - R.openTime);
  }

  private tickClock = (): void => {
    // Background races only need simulating when nothing else is driving them.
    if (!this.isLive) {
      this.races.forEach((r, i) => { if (i !== this.raceIndex) tickBackground(r, i, this.speed); });
    }

    const R = this.race;
    if (R.phase !== 'trade') return;
    // Live, `t` is wall-clock against the market's own window — the demo speed
    // does not apply, because the chain does not care how fast we are watching.
    // It is recomputed HERE, once a second, rather than when the feed polls:
    // the feed arrives every few seconds, and deriving the clock from it made
    // the countdown jump in steps instead of ticking.
    if (this.isLive) this.syncLiveClock();
    else R.t += this.speed;
    // 'OPEN' is only the first beat; after that the aggression phase names it.
    if (this.statusOverride === 'OPEN') this.statusOverride = null;

    // Countdown pips over the last five seconds.
    const left = R.win - R.t;
    const pipWindow = this.isLive ? 5 : this.speed * 5;
    if (left <= pipWindow && left > 0 && this.lastBeepAt !== R.t) {
      this.lastBeepAt = R.t;
      this.audio.countdown();
      if (this.shake < 2.5) this.shake = 2.5;
    }

    // No auto-tuning. It used to drift to whichever race was closest to the
    // post, which suited an idle demo — but the venue runs 60s windows, so a
    // 1M dial is ALWAYS within a minute of expiry. Picking 1H or 4H was undone
    // within the second, and every yank reset the scene. An explicit choice
    // has to win.

    if (R.t >= R.win) {
      R.phase = 'lock';
      this.holdingResult = true;
      this.statusOverride = 'TIME';
      this.audio.horn();
      this.shake = 8;
      this.later(() => this.resolve(), LOCK_SECONDS * 1000);
    }
    this.publish();
  };

  // ------------------------------------------------------------------- resolve

  private resolve(): void {
    const R = this.race;
    R.phase = 'done';

    // The console calls it from the last price it saw. The chain settles against
    // the oracle's closing answer, which can differ by a tick right on the line —
    // the duel screens read the real result, this is the scoreboard.
    const winner: Side = R.spot >= R.strike ? 'up' : 'down';
    R.settled.push({ p: R.spot, w: winner });

    // Demo settles a paper position; live settles the escrow's. Only one of the
    // two can exist at a time — `takePaper` refuses while live — so the paper
    // one simply wins where it is there.
    const paper = R.pos;
    const side = paper?.side ?? this.watchSide;
    const won = side ? side === winner : null;
    const sub = `${winner.toUpperCase()} TAKES IT · ${R.spot.toFixed(0)}`;

    // The streak moves BEFORE the ending is chosen, so a run reads as the one
    // this window just extended.
    if (won === true) this.winStreak += 1;
    else if (won === false) this.winStreak = 0;

    // The stake left the balance when the bet was placed, so settlement adds the
    // payout and nothing else.
    if (paper) this.balance += won ? paper.n : 0;

    // A held side gets the full ending, whether or not the money is known.
    //
    // This used to require `watchEcon` too, and the stake is not always
    // recoverable — it lives in a ref that a reload clears — so a window you
    // were actually in could settle on a bare word and silence. The beats never
    // needed the arithmetic; only the plaque does, and that is the renderer's
    // call to make from `tally.money`.
    const econ = paper ? { stake: paper.cost, payoutIfWon: paper.n } : this.watchEcon;
    const tally = won !== null ? this.tallyFor(econ, won, R) : null;

    if (side && won === false) this.playKill(side, sub, tally);
    else if (side && won === true) this.playStand(side, sub, tally);
    else this.playBystander(winner, sub);

    this.statusOverride = winner === 'up' ? 'BULL TAKES IT' : 'BEAR TAKES IT';
    this.publish();

    this.later(() => {
      // Demo rolls its own window. Live, the VENUE opens the next one — which
      // may be an hour away — so the result stays up and the console says it is
      // waiting rather than resetting to a dead race.
      if (this.isLive) {
        // Same beat as demo: the card holds a moment longer before the next
        // window is allowed in, so a result is read rather than glimpsed.
        this.statusOverride = this.pendingSlot ? 'NEXT WINDOW' : 'WAITING FOR NEXT WINDOW';
        this.publish();
        this.later(() => {
          this.holdingResult = false;
          if (this.pendingSlot) this.rollTo(this.pendingSlot);
        }, 1200);
        return;
      }
      this.statusOverride = 'NEXT PACK FORMING';
      this.publish();
      this.later(() => this.openWindow(), 1200);
      // The card holds for as long as it has beats left to play, which is a
      // question about the tally rather than about the money behind it.
    }, tally ? 5600 : 4200);
  }

  /**
   * The arithmetic behind the result, as the contract did it.
   *
   * Read off the POSITION rather than the live book: `cost / n` is the price
   * actually paid per share, so the odds shown are the ones taken, not whatever
   * the book drifted to while the window ran. Everything reconciles — stake
   * times multiple is the payout — because it is one number expressed three
   * ways, which is what makes the count-up feel earned instead of decorative.
   */
  private tallyFor(
    econ: { stake: number; payoutIfWon: number } | null, won: boolean, R: Race,
  ): Tally {
    const stake = Math.round(econ?.stake ?? 0);
    const total = won ? Math.round(econ?.payoutIfWon ?? 0) : 0;
    const mult = econ && econ.stake > 0 ? econ.payoutIfWon / econ.stake : 0;

    // One payout said three ways is three arrivals instead of one, and the
    // streak line is the only one that is not arithmetic — it is the thing you
    // carry between windows.
    //
    // With no money there are no sums to say three ways, and the breakdown is
    // empty. That is what the beats count, so an unpriced win plays shorter
    // rather than pretending to lines it does not have.
    const items: TallyItem[] = [];
    if (won && econ) {
      items.push({ label: 'stake back', value: `+${stake}`, tone: 'up' });
      items.push({ label: 'winnings', value: `+${total - stake}`, tone: 'up' });
      if (this.winStreak >= 2) {
        items.push({ label: `${this.winStreak} in a row`, value: 'kept', tone: 'gold' });
      }
    }

    const miss = Math.abs(R.spot - R.strike);
    return {
      win: won,
      money: econ !== null,
      stake: money(econ?.stake ?? 0),
      // The split, not the book: in a room the multiple IS the payout.
      oddsPct: mult > 0 ? Math.round((1 / mult) * 100) : 0,
      mult: won ? mult : 0,
      total,
      items,
      net: Math.round(total - stake),
      streak: won ? this.winStreak : 0,
      missedBy: won ? '' : miss.toFixed(2),
      // Close enough that noise decided it rather than the call. The brain files
      // that under "nearly won", which is why it is named — and why naming it is
      // a deliberate choice, not a free one.
      nearMiss: !won && R.strike > 0 && miss / R.strike < 0.0004,
    };
  }

  /**
   * Put a result on the glass and start its count-up.
   *
   * Every outcome goes through here so the card's clock, its sounds and its
   * drawing can never disagree: the renderer's `outcomeT` starts at zero on the
   * frame the card appears, and the pops are scheduled against the same
   * timeline constants the renderer reads.
   */
  private showOutcome(o: Outcome): void {
    this.outcome = o;
    this.outcomeT = 0;
    if (!o.tally) return;

    const T = o.tally;
    const at = (ms: number, fn: () => void) => this.later(() => {
      // The window may have rolled under this timer. Same guard the attack
      // timers use: a beat for a card that is no longer on the glass is worse
      // than a missing one.
      if (this.outcome !== o) return;
      fn();
    }, ms);

    // Two chips, a step apart, then four hundred milliseconds of nothing.
    at(T_STAKE, () => { this.audio.tone(523, 0.09, 'triangle', 0.13); this.centreBurst('198,202,206', 5); });
    at(T_ODDS, () => this.audio.tone(659, 0.09, 'triangle', 0.13));

    // The multiple arrives. A win bends upward; a loss is a dead square drop.
    at(T_MULT, () => {
      if (T.win) { this.audio.tone(196, 0.24, 'sawtooth', 0.17, 784); this.shake = 6; }
      else { this.audio.tone(200, 0.34, 'square', 0.15, 58); this.shake = 4; }
      this.centreBurst(T.win ? '255,215,119' : '255,117,102', 14);
    });

    // The collision.
    at(T_SLAM, () => {
      if (T.win) {
        this.audio.clash();
        this.audio.chord();
        this.flash = 0.6; this.flashCol = '255,215,119';
        this.centreBurst('255,215,119', 46);
      } else {
        this.audio.tone(140, 0.7, 'sawtooth', 0.15, 44);
        this.flash = 0.45; this.flashCol = '255,90,72';
        this.centreBurst('255,117,102', 20);
      }
    });

    // The drain has its own falling tone under it, so a loss is heard emptying
    // rather than just seen at zero.
    if (!T.win) at(T_SLAM + 120, () => this.audio.noise(T_COUNT / 1000, 0.1, 500));

    // Each breakdown line a step higher than the last: the ladder is what tells
    // the ear something is still accumulating.
    T.items.forEach((_, i) => at(tallyItemAt(i), () => {
      this.audio.tone(659 + i * 165, 0.1, 'triangle', 0.14);
      this.centreBurst('255,200,87', 8);
    }));

    // The last word. A run gets an extra flourish — the streak is the reason to
    // come back, so it is the last thing heard.
    at(tallyEndAt(T.items.length), () => {
      if (!T.win) return;
      this.audio.escape();
      this.centreBurst('255,200,87', 26);
      this.flash = 0.3; this.flashCol = '255,215,119';
    });
    if (T.win && T.streak >= 2) {
      at(tallyEndAt(T.items.length) + 420, () => { this.audio.chord(); this.centreBurst('255,255,255', 18); });
    }
  }

  /** You lost. The animal whose territory you ended in collects. */
  private playKill(side: Side, sub: string, tally: Tally | null): void {
    // You were DOWN and lost, so the bull took it — and vice versa.
    const type = side === 'down' ? 'gore' : 'claw';
    const winner: Side = type === 'gore' ? 'up' : 'down';
    const hx = type === 'gore' ? this.bullX : this.bearX;
    const hy = type === 'gore' ? this.bullY : this.bearY;
    const w = this.ctx?.canvas.clientWidth ?? 320;
    // Captured locally, not read back off `this.attack`: these timers fire up to
    // 2.2s later, and anything that calls resetScene() in between — tuning to
    // another race, the next window opening — nulls the field out from under them.
    const atk: Attack = { type, t: 0, x: Math.max(60, Math.min(w - 80, hx + 34)), y: hy };
    this.attack = atk;
    this.flash = 0.5; this.flashCol = '255,200,87';

    if (type === 'gore') {
      this.audio.paw();
      this.later(() => this.audio.charge(), 250);
      this.later(() => { this.audio.gore(); this.flash = 1; this.flashCol = '255,255,255'; }, 520);
      this.later(() => { this.flash = 0.6; this.flashCol = '255,90,72'; }, 580);
      this.later(() => this.audio.stomp(), 1720);
      this.later(() => { this.flash = 0.9; this.flashCol = '255,90,72'; }, 1730);
    } else {
      this.audio.rear();
      for (const d of [300, 360, 420]) {
        this.later(() => this.slashes.push({ x: atk.x + 14, y: atk.y - 4, t: 0 }), d);
      }
      this.later(() => this.audio.claw(), 290);
      this.later(() => { this.audio.chomp(); this.flash = 1; this.flashCol = '255,255,255'; }, 520);
      this.later(() => { this.flash = 0.6; this.flashCol = '255,90,72'; }, 580);
      this.later(() => this.audio.shakePrey(), 760);
      this.later(() => this.audio.slam(), 1720);
      this.later(() => { this.flash = 0.9; this.flashCol = '255,90,72'; }, 1730);
    }

    this.later(() => {
      if (this.attack !== atk) return;   // the scene moved on; leave it alone
      this.attack = null;
      this.showOutcome({ win: false, winner, txt: type === 'gore' ? 'GORED' : 'MAULED', sub, tally });
      this.flash = 0.8; this.flashCol = '255,90,72';
      this.centreBurst('255,117,102', 40);
    }, 2200);
  }

  /** You won. The hunter charges one last time and is thrown back. */
  private playStand(side: Side, sub: string, tally: Tally | null): void {
    const beast = side === 'up' ? 'bear' : 'bull';
    const hx = beast === 'bull' ? this.bullX : this.bearX;
    const hy = beast === 'bull' ? this.bullY : this.bearY;
    const w = this.ctx?.canvas.clientWidth ?? 320;
    const atk: Attack = { type: 'stand', beast, t: 0, x: Math.max(90, Math.min(w - 70, hx + 60)), y: hy };
    this.attack = atk;

    this.audio.brace();
    this.later(() => { this.audio.clash(); this.flash = 1; this.flashCol = '255,255,255'; }, 400);
    this.later(() => { this.audio.repel(); this.flash = 0.7; this.flashCol = '255,215,119'; }, 630);
    this.later(() => this.audio.chord(), 1080);
    this.later(() => {
      if (this.attack !== atk) return;   // the scene moved on; leave it alone
      this.attack = null;
      // You won, so the side you were on is the side that took it.
      this.showOutcome({ win: true, winner: side, txt: 'HELD THE LINE', sub, tally });
      this.flash = 0.7; this.flashCol = '255,215,119';
      this.centreBurst('255,215,119', 50);
    }, 1960);
  }

  /** You sat this one out — or bailed. No cinematic, just the call. */
  private playBystander(winner: Side, sub: string): void {
    this.showOutcome({
      win: true,
      winner,
      txt: winner === 'up' ? 'BULL TAKES IT' : 'BEAR TAKES IT',
      sub,
      tally: null,
    });
    this.flash = 1; this.flashCol = '255,200,87';
    this.shake = 9;
    this.centreBurst('255,200,87', 46);
  }

  private centreBurst(col: string, n: number): void {
    const c = this.ctx?.canvas;
    burst(this.particles, (c?.clientWidth ?? 320) / 2, (c?.clientHeight ?? 198) / 2, n, col, 9);
  }

  // ------------------------------------------------------------------- actions

  /** Must be called from a real pointer event before any sound will play. */
  wake(): void { this.audio.start(); }




  // ---- the dials, as the tuner sees them ---------------------------------
  //
  // The venue runs five intervals per asset, not two, so the dial structure is
  // read off whatever races exist rather than assumed. Demo mode's four fixed
  // markets fall out of the same code.

  private assetOf(r: Race): string {
    return this.isLive ? r.symbol : MARKETS[this.races.indexOf(r)]?.asset ?? r.symbol;
  }

  private labelOf(r: Race): string {
    return this.isLive ? intervalLabel(r.win) : MARKETS[this.races.indexOf(r)]?.interval ?? intervalLabel(r.win);
  }

  private get assets(): string[] {
    const out: string[] = [];
    for (const r of this.races) {
      const a = this.assetOf(r);
      if (!out.includes(a)) out.push(a);
    }
    return out;
  }

  tune(index: number): void {
    // Any deliberate tune settles the opening question for good.
    this.openingChosen = true;
    if (index === this.raceIndex || !this.races[index]) return;
    this.raceIndex = index;
    this.resetScene();
    this.labelWindow();
    this.statusOverride = null;
    this.audio.tuneClick();
    this.publish();
  }

  /** Every race on the current asset, shortest window first. */
  private get intervalsForCurrentAsset(): Race[] {
    const asset = this.assetOf(this.race);
    return this.races.filter((r) => this.assetOf(r) === asset).sort((a, b) => a.win - b.win);
  }

  /** Tune to a market by id, if it is one of the four dials. Returns false when
   *  it is not — the caller then has to do something else with it. */
  tuneToMarket(marketId: string): boolean {
    const i = this.races.findIndex((r) => r.marketId === marketId);
    if (i < 0) return false;
    if (i !== this.raceIndex) this.tune(i);
    return true;
  }

  /** The market currently on the dials, for a list that wants to mark it. */
  get currentMarketId(): string { return this.race.marketId; }

  /** Seconds left in the current window. */
  windowLeft(): number { return Math.max(0, this.race.win - this.race.t); }

  /** Step through the dials. On the game face this is what the pad's arrows do,
   *  so they always mean something rather than sitting dead. */
  tuneStep(delta: 1 | -1): void {
    const n = this.races.length;
    if (!n) return;
    this.tune(((this.raceIndex + delta) % n + n) % n);
  }

  /** Switch asset, keeping the window length where the new asset has one.
   *  Falling back to the nearest is kinder than dumping you on 24h because BTC
   *  happens to list a window ETH does not. */
  tuneAsset(index: number): void {
    const asset = this.assets[index];
    if (!asset) return;
    const want = this.race.win;
    const candidates = this.races.filter((r) => this.assetOf(r) === asset);
    if (!candidates.length) return;
    const best = candidates.reduce((a, b) =>
      Math.abs(b.win - want) < Math.abs(a.win - want) ? b : a);
    this.tune(this.races.indexOf(best));
  }

  tuneInterval(index: number): void {
    const target = this.intervalsForCurrentAsset[index];
    if (target) this.tune(this.races.indexOf(target));
  }

  /** One step along the interval wheel. */
  stepInterval(delta: 1 | -1): void {
    const list = this.intervalsForCurrentAsset;
    const at = list.indexOf(this.race);
    const next = at + delta;
    if (next >= 0 && next < list.length) this.tune(this.races.indexOf(list[next]!));
  }

  cycleSpeed(): void {
    const i = SPEEDS.indexOf(this.speed);
    this.speed = SPEEDS[(i + 1) % SPEEDS.length]!;
    this.audio.tone(660, 0.07, 'square', 0.05);
    this.publish();
  }
}
