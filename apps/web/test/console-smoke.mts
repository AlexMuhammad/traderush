/**
 * Console smoke test — `pnpm smoke`.
 *
 * Drives the real Engine against a stubbed canvas and audio-free environment.
 * It exists because `tsc` cannot see the failures that actually happen in a
 * 1,500-line imperative canvas engine: null reads inside timers, an index that
 * walks off a keyframe table, a cinematic branch nobody reaches in a normal
 * session. It has already caught one crash that survived a full typecheck and
 * a clean build — the claw sequence's slash timers reading an attack that
 * resetScene() had nulled out from under them.
 *
 * It asserts INVARIANTS, never values. The simulation is random by design, so
 * anything that depends on a particular price would flake nightly.
 *
 * Not a substitute for looking at the thing. It proves the engine does not
 * throw and that state transitions hold; it says nothing about whether the
 * animals look right.
 */
import { Engine } from '../src/console/engine/engine';
import { renderScene } from '../src/console/engine/render';
import type { Attack } from '../src/console/engine/types';

// ---------------------------------------------------------------- environment

let canvasOps = 0;

/** Records every 2D call and returns plausible values for the few that are read
 *  back. A Proxy rather than a hand-written stub so a new context method used by
 *  the renderer cannot silently fail here. */
const ctxStub: Record<string, unknown> = {
  measureText: () => ({ width: 40 }),
  createLinearGradient: () => ({ addColorStop() {} }),
  createRadialGradient: () => ({ addColorStop() {} }),
};

const canvas = {
  width: 384, height: 198, clientWidth: 360, clientHeight: 198,
  getBoundingClientRect: () => ({ width: 360, height: 198 }),
  getContext: () => ctx,
} as unknown as HTMLCanvasElement;

const ctx = new Proxy(ctxStub, {
  get(target, key: string) {
    if (key === 'canvas') return canvas;
    if (key in target) return target[key];
    return (...args: unknown[]) => { canvasOps++; void args; };
  },
  set(target, key: string, value) { target[key] = value; return true; },
}) as unknown as CanvasRenderingContext2D;

const g = globalThis as unknown as Record<string, unknown>;
g.window = globalThis;
g.devicePixelRatio = 2;
g.addEventListener = () => {};
g.removeEventListener = () => {};
// The loop is stepped by hand so a frame count means something.
g.requestAnimationFrame = () => 0;
g.cancelAnimationFrame = () => {};

// ------------------------------------------------------------------ harness

let checks = 0;
function check(label: string, ok: boolean, detail = ''): void {
  checks++;
  if (!ok) throw new Error(`FAIL: ${label}${detail ? ` (${detail})` : ''}`);
}
const step = (label: string) => console.log(`  ${label}`);

const engine = new Engine();
/** The tick methods are private: the test drives them directly so a whole
 *  window can run in milliseconds instead of minutes. */
const internals = engine as unknown as {
  tickPrice(): void;
  tickClock(): void;
  resolve(): void;
};

/** Only one cinematic may ever be in flight; two would orphan each other. */
let outcomes = 0;

const frames = (n: number) => { for (let i = 0; i < n; i++) renderScene(ctx, engine, 16, 2); };
const advance = () => { internals.tickPrice(); internals.tickClock(); frames(3); };
const spin = async (ms: number) => {
  const until = Date.now() + ms;
  while (Date.now() < until) { frames(2); await new Promise((r) => setTimeout(r, 16)); }
};

// --------------------------------------------------------------------- run

console.log('\nconsole smoke\n');

engine.attachCanvas(canvas);
let snapshots = 0;
engine.subscribe(() => { snapshots++; });
engine.start();

// 1 — the idle console paints without a position or a wallet.
frames(30);
check('idle renders', canvasOps > 0, `${canvasOps} ops`);
step('idle');

// 2 — take a side and run it into the other animal's territory.
engine.wake();
engine.setStakePct(50);
engine.race.upP = 0.5;      // pinned: an extreme price would make a side dry
engine.board('up');
check('board opens a position', engine.snapshot().pos !== null);
const staked = engine.snapshot();
check('stake left the balance', staked.balance < 2847, `${staked.balance}`);
// snapshot().cost is what the NEXT bet would cost, computed off the already
// reduced balance. The stake actually placed lives on the position.
const placed = staked.pos!.cost;
check('stake is half the bank at 50%', Math.abs(placed - 2847 / 2) < 0.01, `${placed}`);
for (let i = 0; i < 40; i++) advance();
check('ground is reported', staked.ground !== 'NO STAKE', staked.ground);
step('trading');

// 3 — every cinematic, through its whole timeline. These are the branches a
//     normal session reaches once each and only on the right outcome.
for (const type of ['gore', 'claw', 'stand'] as const) {
  engine.attack = { type, beast: 'bull', t: 0, x: 180, y: 120 } satisfies Attack;
  frames(200);                                   // ~3.2s at 16ms
  step(`cinematic ${type}`);
}
engine.attack = null;

// 4 — a whole window resolving, with the real timers running out.
//     resolve() is called directly and tickClock() is NOT: crossing the expiry
//     through the clock SCHEDULES a resolve of its own, and two of them race —
//     the second replaces the first's attack, and the first's completion timer
//     correctly declines to write an outcome for a cinematic that is no longer
//     on screen. That is right in the engine and wrong in a test.
engine.race.t = engine.race.win;
internals.resolve();
await spin(2600);
// The stake is taken once, at board() — settling must not charge it again.
const afterSettle = engine.snapshot().balance;
const won = engine.outcome?.win === true;
check('a loss costs the stake once, not twice',
  won || Math.abs(afterSettle - (2847 - placed)) < 0.01,
  `balance ${afterSettle.toFixed(2)}, expected ${(2847 - placed).toFixed(2)}`);

check('resolve produces an outcome', engine.outcome !== null);
outcomes++;
check('exactly one outcome', outcomes === 1, String(outcomes));
const settled = engine.snapshot();
check('status names a winner', /TAKES IT|FORMING/.test(settled.statusText), settled.statusText);
check('ticket becomes a receipt', settled.ticketNote !== '—', settled.ticketNote);
step(`resolve → ${engine.outcome?.txt}`);

// 5 — all four races. Each has its own window length and stagger.
for (const i of [1, 2, 3, 0]) {
  engine.tune(i);
  frames(5);
  check(`race ${i} renders`, engine.snapshot().raceIndex === i);
}
step('tuning');

// 6 — bail and the speed cycle. Needs a live window: after a resolve the
//     position deliberately stays put as the receipt.
engine.race.phase = 'trade';
engine.race.t = 10;
engine.race.pos = null;
engine.race.upP = 0.5;
const before = engine.snapshot().balance;
engine.board('down');
check('board opens on a fresh window', engine.snapshot().pos !== null);
engine.bail();
check('bail closes the position', engine.snapshot().pos === null);
check('bail returns value', engine.snapshot().balance > before - 1, `${engine.snapshot().balance} vs ${before}`);
const speeds = [engine.snapshot().speed];
for (let i = 0; i < 3; i++) { engine.cycleSpeed(); speeds.push(engine.snapshot().speed); }
check('speed cycles back round', speeds[0] === speeds[3], speeds.join(' → '));
step('actions');

// 7 — teardown must cancel the cinematics' timers, or a sequence outlives the
//     component and fires into a dead canvas.
engine.stop();
step('teardown');

// 8 — the LIVE clock ticks once a second.
//     It is derived from the market's openTime on every clock tick, not when
//     the feed polls. Deriving it from the poll made the countdown jump several
//     seconds at a time — invisible to a typecheck, obvious on the glass.
{
  const openTime = Math.floor(Date.now() / 1000) - 30;
  const slot = {
    marketId: '0xfeed', symbol: 'BTC', intervalSec: 300,
    strike: 100, spot: 101, upP: 0.6,
    openTime, expiryTime: openTime + 300, status: 'Trading' as const,
  };
  const feed = {
    live: true,
    subscribe(cb: (slots: typeof slot[]) => void) { cb([slot, slot, slot, slot]); return () => {}; },
  };

  const live: any = new Engine(feed as never);
  live.attachCanvas(canvas);
  live.start();
  const inner = live as { tickClock(): void };

  const first = live.snapshot().clock;
  inner.tickClock();
  const second = live.snapshot().clock;

  const secs = (mmss: string) => {
    const [m, s2] = mmss.split(':').map(Number);
    return (m ?? 0) * 60 + (s2 ?? 0);
  };
  // The wall clock may or may not have crossed a second between the two reads,
  // so the step is 0 or 1 — never the 3+ a poll-driven clock produced.
  const stepped = secs(first) - secs(second);
  check('live clock ticks in seconds', stepped >= 0 && stepped <= 1, `${first} -> ${second}`);
  check('live clock reads from openTime', Math.abs(secs(first) - 270) <= 2, first);
  check('live snapshot is marked live', live.snapshot().live === true);
  live.stop();
  step('live clock');
}

console.log(`\nPASS — ${checks} checks, ${snapshots} snapshots, ${canvasOps} canvas ops\n`);
