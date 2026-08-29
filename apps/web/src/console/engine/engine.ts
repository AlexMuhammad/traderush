import { Audio } from './audio';
import { newBeastState, type BeastState } from './beasts';
import { burst } from './fx';
import {
  MARKETS, HIST_MAX, initialRaces, newRace, tickBackground, tickPrice,
  money, mmss, utcLabel, intervalLabel,
} from './market';
import { renderScene, type Scene } from './render';
import type {
  Attack, ConsoleSnapshot, FeedSlot, MarketFeed, Outcome, Particle, Race, Ring, Side, Slash,
} from './types';

/** Seconds between the window closing and the result landing. */
const LOCK_SECONDS = 2.2;
/** Segments in the progress bar. Fixed, so 15m and 1h windows look alike. */
export const PROGRESS_SEGMENTS = 48;
/** Demo speeds, cycled by the footer. 1 is real time. */
const SPEEDS = [20, 5, 1];
/** Below this implied probability a side is treated as having no liquidity. */
const DRY = 0.04;

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
  speed = SPEEDS[0]!;
  readonly audio = new Audio();

  particles: Particle[] = [];
  rings: Ring[] = [];
  slashes: Slash[] = [];
  attack: Attack | null = null;
  outcome: Outcome | null = null;

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
  phaseName = 'OPEN';
  chased = false;

  // --- console state -------------------------------------------------------
  private races: Race[] = initialRaces();
  private raceIndex = 0;
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
  }

  /** Sizes the backing store to the CSS box at device pixel ratio. */
  fit = (): void => {
    const c = this.ctx; if (!c) return;
    const r = c.canvas.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    c.canvas.width = r.width * dpr;
    c.canvas.height = r.height * dpr;
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
      renderScene(this.ctx, this, dt, Math.min(2, devicePixelRatio || 1));
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
    const cost = this.balance * this.stakePct / 100;
    const progress = Math.min(1, R.t / R.win);

    const myOdds = R.pos ? (R.pos.side === 'up' ? upP : 1 - upP) : 0;
    const value = R.pos ? R.pos.n * myOdds : 0;
    const danger = R.pos ? (R.pos.side === 'up' ? !bullish : bullish) : false;
    const threat = R.pos ? 1 - myOdds : 0;
    const urgent = R.phase === 'trade' && progress > 0.90;

    let ground = 'NO STAKE';
    if (R.pos) ground = danger ? (myOdds < 0.2 ? 'HORNS OUT' : 'IN ITS TERRITORY') : 'HOME GROUND';

    return {
      asset: this.isLive ? R.symbol : MARKETS[this.raceIndex]!.asset,
      interval: this.isLive ? intervalLabel(R.win) : MARKETS[this.raceIndex]!.interval,
      slots: this.races.map((r, i) => (this.isLive
        ? { asset: r.symbol, interval: intervalLabel(r.win) }
        : { asset: MARKETS[i]!.asset, interval: MARKETS[i]!.interval })),
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

      pos: R.pos,
      pnl: R.pos ? value - R.pos.cost : 0,
      bailValue: value,
      ticketSide: R.pos
        ? `${R.pos.side === 'up' ? '▲ UP' : '▼ DOWN'} · ${R.pos.n.toFixed(0)} sh @ ${Math.round((R.pos.side === 'up' ? upP : 1 - upP) * 100)}%`
        : '—',
      ticketNote: this.ticketNote(),
      bailLabel: this.bailLabel(value),
      canBail: R.phase === 'trade' && Boolean(R.pos),
      ground,

      balance: this.balance,
      stakePct: this.stakePct,
      cost,
      costNote: `Cost · ${(cost / Math.max(0.01, upP)).toFixed(0)} shares if up`,
      dryUp: upP <= DRY,
      dryDown: upP >= 1 - DRY,

      speed: this.speed,
    };
  }

  /** Before settlement this is the terms; after it, what actually happened. */
  private ticketNote(): string {
    const R = this.race;
    if (!R.pos) return '—';
    if (R.phase !== 'done') {
      return `Paid ${money(R.pos.cost)} · pays ${R.pos.n.toFixed(0)} if it holds`;
    }
    const won = R.pos.side === (R.spot >= R.strike ? 'up' : 'down');
    return won ? `Redeemed ${money(R.pos.n)} USDso` : 'Expired worthless';
  }

  private bailLabel(value: number): string {
    const R = this.race;
    if (!R.pos) return 'Bail out';
    if (R.phase !== 'done') return `Bail out · ${money(value)}`;
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
    this.particles = []; this.slashes = []; this.rings = [];
    this.outcome = null; this.attack = null;
    this.lunge = 0; this.lastBeepAt = -1;
    this.beasts.bull = newBeastState(900);
    this.beasts.bear = newBeastState(1100);
    this.bullX = this.bullY = this.bearX = this.bearY = 0;
    this.bullA = this.bearA = 1;
  }

  /**
   * Fold a reading of the live markets onto the four dials.
   *
   * The engine owns `hist`, `pos` and the cinematics; the chain owns everything
   * else. A CHANGED marketId in a slot means that window rolled and a new one
   * opened underneath us — which is a real event, not a glitch, so it resets the
   * scene the same way a simulated roll does.
   */
  private applySlots(slots: FeedSlot[]): void {
    const now = Math.floor(Date.now() / 1000);
    let touchedCurrent = false;

    slots.forEach((slot, i) => {
      const prev = this.races[i];
      const rolled = !prev || prev.marketId !== slot.marketId;

      if (rolled) {
        this.races[i] = {
          marketId: slot.marketId,
          symbol: slot.symbol,
          win: slot.intervalSec || 900,
          t: Math.max(0, now - slot.openTime),
          openTime: slot.openTime,
          strike: slot.strike,
          spot: slot.spot,
          upP: slot.upP,
          hist: [slot.spot || slot.strike],
          pos: null,
          phase: 'trade',
          wasDanger: false,
          // A rolled window keeps the series' form guide.
          settled: prev?.settled ?? [],
        };
        if (i === this.raceIndex) touchedCurrent = true;
        return;
      }

      prev.symbol = slot.symbol;
      prev.win = slot.intervalSec || prev.win;
      prev.strike = slot.strike || prev.strike;
      prev.upP = slot.upP || prev.upP;
      prev.openTime = slot.openTime;
      prev.t = Math.max(0, now - slot.openTime);
      if (slot.spot > 0 && slot.spot !== prev.spot) {
        prev.spot = slot.spot;
        prev.hist.push(slot.spot);
        if (prev.hist.length > HIST_MAX) prev.hist.shift();
      }
    });

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

    this.autoTune();

    if (R.t >= R.win) {
      R.phase = 'lock';
      this.statusOverride = 'TIME';
      this.audio.horn();
      this.shake = 8;
      this.later(() => this.resolve(), LOCK_SECONDS * 1000);
    }
    this.publish();
  };

  /** With no stake and time to spare, drift to whichever race is closest to
   *  the post. It keeps an idle console showing something about to happen. */
  private autoTune(): void {
    const R = this.race;
    if (R.pos || R.phase !== 'trade' || R.win - R.t <= 120) return;
    const candidate = this.races
      .map((r, i) => ({ i, left: i === this.raceIndex ? R.win - R.t : r.win - r.t }))
      .filter((x) => x.i !== this.raceIndex && !this.races[x.i]!.pos && x.left < 60)
      .sort((a, b) => a.left - b.left)[0];
    if (candidate) this.tune(candidate.i);
  }

  // ------------------------------------------------------------------- resolve

  private resolve(): void {
    const R = this.race;
    R.phase = 'done';

    // The console calls it from the last price it saw. The chain settles against
    // the oracle's closing answer, which can differ by a tick right on the line —
    // the duel screens read the real result, this is the scoreboard.
    const winner: Side = R.spot >= R.strike ? 'up' : 'down';
    R.settled.push({ p: R.spot, w: winner });

    const won = R.pos ? R.pos.side === winner : null;
    let sub = `${winner.toUpperCase()} TAKES IT · ${R.spot.toFixed(0)}`;

    if (R.pos) {
      const payout = won ? R.pos.n : 0;
      // The stake left the balance when the bet was placed (see board()), so
      // settlement adds the payout and nothing else. Subtracting the cost again
      // here — which the prototype did — charges a loss twice and, after two of
      // them, leaves the balance at zero with no way back.
      this.balance += payout;
      sub = won ? `+${money(payout - R.pos.cost)} USDso` : `-${money(R.pos.cost)} USDso`;
    }

    if (R.pos && won === false) this.playKill(R.pos.side, sub);
    else if (R.pos && won === true) this.playStand(R.pos.side, sub);
    else this.playBystander(winner, sub);

    this.statusOverride = winner === 'up' ? 'BULL TAKES IT' : 'BEAR TAKES IT';
    this.publish();

    this.later(() => {
      // Demo rolls its own window. Live, the VENUE opens the next one — which
      // may be an hour away — so the result stays up and the console says it is
      // waiting rather than resetting to a dead race.
      if (this.isLive) {
        this.statusOverride = 'WAITING FOR NEXT WINDOW';
        this.publish();
        return;
      }
      this.statusOverride = 'NEXT PACK FORMING';
      this.publish();
      this.later(() => this.openWindow(), 1200);
    }, 4200);
  }

  /** You lost. The animal whose territory you ended in collects. */
  private playKill(side: Side, sub: string): void {
    const type = side === 'down' ? 'gore' : 'claw';
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
      this.outcome = { win: false, txt: type === 'gore' ? 'GORED' : 'MAULED', sub };
      this.flash = 0.8; this.flashCol = '255,90,72';
      this.centreBurst('255,117,102', 40);
    }, 2200);
  }

  /** You won. The hunter charges one last time and is thrown back. */
  private playStand(side: Side, sub: string): void {
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
      this.outcome = { win: true, txt: 'HELD THE LINE', sub };
      this.flash = 0.7; this.flashCol = '255,215,119';
      this.centreBurst('255,215,119', 50);
    }, 1960);
  }

  /** You sat this one out — or bailed. No cinematic, just the call. */
  private playBystander(winner: Side, sub: string): void {
    this.outcome = {
      win: true,
      txt: winner === 'up' ? 'BULL TAKES IT' : 'BEAR TAKES IT',
      sub,
    };
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

  board(side: Side): void {
    const R = this.race;
    if (R.phase !== 'trade' || R.pos) return;
    const price = side === 'up' ? R.upP : 1 - R.upP;
    if ((side === 'up' && R.upP <= DRY) || (side === 'down' && R.upP >= 1 - DRY)) return;

    const cost = this.balance * this.stakePct / 100;
    if (cost <= 0) return;

    R.pos = { side, n: cost / price, cost };
    this.balance -= cost;
    R.wasDanger = side === 'up' ? R.spot < R.strike : R.spot >= R.strike;

    this.shake = 7;
    this.flash = 0.6;
    this.flashCol = side === 'up' ? '63,217,139' : '255,90,72';
    this.centreBurst(side === 'up' ? '91,240,166' : '255,117,102', 26);
    this.audio.board(side);
    this.publish();
  }

  bail(): void {
    const R = this.race;
    if (!R.pos || R.phase !== 'trade') return;
    this.balance += R.pos.n * (R.pos.side === 'up' ? R.upP : 1 - R.upP);
    R.pos = null;
    this.shake = 4;
    this.audio.bail();
    this.publish();
  }

  setStakePct(pct: number): void { this.stakePct = pct; this.publish(); }

  tune(index: number): void {
    if (index === this.raceIndex || !this.races[index]) return;
    this.raceIndex = index;
    this.resetScene();
    this.labelWindow();
    this.statusOverride = null;
    this.audio.tuneClick();
    this.publish();
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

  /** Step through the dials. On the game face this is what the pad's arrows do,
   *  so they always mean something rather than sitting dead. */
  tuneStep(delta: 1 | -1): void {
    const n = this.races.length;
    if (!n) return;
    this.tune(((this.raceIndex + delta) % n + n) % n);
  }

  tuneAsset(asset: 0 | 1): void { this.tune(asset * 2 + (this.raceIndex % 2)); }
  tuneInterval(iv: 0 | 1): void { this.tune((this.raceIndex >= 2 ? 2 : 0) + iv); }

  cycleSpeed(): void {
    const i = SPEEDS.indexOf(this.speed);
    this.speed = SPEEDS[(i + 1) % SPEEDS.length]!;
    this.audio.tone(660, 0.07, 'square', 0.05);
    this.publish();
  }
}
