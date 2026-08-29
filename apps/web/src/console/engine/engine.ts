import { Audio } from './audio';
import { newBeastState, type BeastState } from './beasts';
import { burst } from './fx';
import {
  MARKETS, initialRaces, newRace, tickBackground, tickPrice,
  money, mmss, utcLabel,
} from './market';
import { renderScene, type Scene } from './render';
import type {
  Attack, ConsoleSnapshot, Outcome, Particle, Race, Ring, Side, Slash,
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

  private ctx: CanvasRenderingContext2D | null = null;
  private raf = 0;
  private priceTimer = 0;
  private clockTimer = 0;
  private lastFrameAt = performance.now();
  private timeouts: ReturnType<typeof setTimeout>[] = [];
  private listeners = new Set<Listener>();

  get race(): Race { return this.races[this.raceIndex]!; }

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
    // Seed a form guide so the first window is not the first result ever.
    for (let i = 0; i < 5; i++) {
      this.race.settled.push({ p: 77000 + Math.random() * 2500, w: Math.random() < 0.5 ? 'up' : 'down' });
    }
    this.openWindow();
    addEventListener('resize', this.fit);
    this.priceTimer = window.setInterval(this.tickPrice, 170);
    this.clockTimer = window.setInterval(this.tickClock, 1000);
    this.loop();
  }

  stop(): void {
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
    const def = MARKETS[this.raceIndex]!;
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
      asset: def.asset,
      interval: def.interval,
      raceIndex: this.raceIndex,
      riders: this.riders,
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
    const def = MARKETS[this.raceIndex]!;
    const carried = this.race.settled;
    this.races[this.raceIndex] = { ...newRace(this.raceIndex, 0), settled: carried };

    this.resetScene();
    this.riders = `${def.asset} ${def.interval} · ${14 + Math.floor(Math.random() * 30)} running`;
    this.expiryLabel = utcLabel(def.sec);
    this.statusOverride = 'OPEN';
    this.publish();
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

  // --------------------------------------------------------------------- ticks

  private tickPrice = (): void => {
    if (this.race.phase !== 'trade') return;
    tickPrice(this.race, this.speed);
    this.publish();
  };

  private tickClock = (): void => {
    this.races.forEach((r, i) => { if (i !== this.raceIndex) tickBackground(r, i, this.speed); });

    const R = this.race;
    if (R.phase !== 'trade') return;
    R.t += this.speed;
    // 'OPEN' is only the first beat; after that the aggression phase names it.
    if (this.statusOverride === 'OPEN') this.statusOverride = null;

    // Countdown pips over the last five seconds of real time.
    const left = R.win - R.t;
    if (left <= this.speed * 5 && left > 0 && this.lastBeepAt !== R.t) {
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
    if (index === this.raceIndex) return;
    this.raceIndex = index;
    this.resetScene();
    const def = MARKETS[index]!;
    this.riders = `${def.asset} ${def.interval} · ${14 + Math.floor(Math.random() * 30)} running`;
    this.expiryLabel = utcLabel(Math.max(0, this.race.win - this.race.t));
    this.statusOverride = null;
    this.audio.tuneClick();
    this.publish();
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
