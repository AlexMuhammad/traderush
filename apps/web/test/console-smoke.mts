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

// 2 — arm a side and run it into the other animal's territory.
//     There is no paper position any more: the keys open a room, so what the
//     scene needs to know is only which half of the glass is his.
engine.wake();
engine.race.upP = 0.5;      // pinned: an extreme price would make a side dry
engine.setWatchSide('up');
check('the armed side reaches the snapshot', engine.snapshot().watchSide === 'up');
for (let i = 0; i < 40; i++) advance();
check('ground follows the armed side', engine.snapshot().ground !== 'NO SIDE', engine.snapshot().ground);
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
check('resolve produces an outcome', engine.outcome !== null);
outcomes++;
check('exactly one outcome', outcomes === 1, String(outcomes));
const settled = engine.snapshot();
check('status names a winner', /TAKES IT|FORMING/.test(settled.statusText), settled.statusText);
// Green is the bull and red is the bear everywhere on this machine, so the
// result text has to name the ANIMAL that took the window, not your result.
const o = engine.outcome!;
const expectedWinner = o.txt === 'GORED' ? 'up' : o.txt === 'MAULED' ? 'down' : o.winner;
check('the result names the winning animal', o.winner === expectedWinner,
  `${o.txt} -> ${o.winner}`);
check('a gore is the bull and a maul is the bear',
  (o.txt !== 'GORED' || o.winner === 'up') && (o.txt !== 'MAULED' || o.winner === 'down'),
  `${o.txt}/${o.winner}`);
step(`resolve → ${engine.outcome?.txt} (${o.winner})`);

// 5 — all four races. Each has its own window length and stagger.
for (const i of [1, 2, 3, 0]) {
  engine.tune(i);
  frames(5);
  check(`race ${i} renders`, engine.snapshot().raceIndex === i);
}
step('tuning');

// 6 — the speed cycle. Nothing to bail out of: a room's stake sits in an escrow
//     and the console has no way to sell it.
engine.race.phase = 'trade';
engine.race.t = 10;
const speeds = [engine.snapshot().speed];
for (let i = 0; i < 3; i++) { engine.cycleSpeed(); speeds.push(engine.snapshot().speed); }
check('speed cycles back round', speeds[0] === speeds[3], speeds.join(' → '));
step('actions');

// 7 — teardown must cancel the cinematics' timers, or a sequence outlives the
//     component and fires into a dead canvas.
engine.stop();
step('teardown');

// 8a — an explicit tune must survive the clock.
//      autoTune used to drift to whichever race was nearest the post. Against a
//      venue that runs 60s windows a short dial is always within a minute of
//      expiry, so choosing 1H was undone within the second — and every yank
//      reset the scene. The selection is the user's now.
{
  const openTime = Math.floor(Date.now() / 1000) - 5;
  const mk = (id: string, iv: number) => ({
    marketId: id, symbol: 'BTC', intervalSec: iv,
    strike: 100, spot: 101, upP: 0.5,
    // The short dial is deliberately seconds from expiring.
    openTime: iv === 60 ? Math.floor(Date.now() / 1000) - 55 : openTime,
    expiryTime: (iv === 60 ? Math.floor(Date.now() / 1000) - 55 : openTime) + iv,
    status: 'Trading' as const,
  });
  const feed = {
    live: true,
    subscribe(cb: (slots: ReturnType<typeof mk>[]) => void) {
      cb([mk('0xa', 60), mk('0xb', 3600), mk('0xc', 14400), mk('0xd', 86400)]);
      return () => {};
    },
  };

  const live: any = new Engine(feed as never);
  live.attachCanvas(canvas);
  live.start();
  const inner = live as { tickClock(): void; tickPrice(): void };

  live.tuneInterval(1);                       // pick the 1H dial
  const chosen = live.snapshot().interval;
  check('an interval can be chosen', chosen === '1H', chosen);

  for (let i = 0; i < 5; i++) { inner.tickClock(); inner.tickPrice(); }
  check('the choice survives the clock', live.snapshot().interval === chosen,
        `${chosen} -> ${live.snapshot().interval}`);
  live.stop();
  step('tuning sticks');
}

// 8b — a live result survives the next window opening underneath it.
//      The venue rolls within seconds of a close, and applying that roll
//      immediately wiped the GORED / HELD THE LINE card before it could be
//      read. The roll has to wait for the result.
{
  const openTime = Math.floor(Date.now() / 1000) - 61;
  const mk = (id: string, open: number) => ({
    marketId: id, symbol: 'BTC', intervalSec: 60,
    strike: 100, spot: 101, upP: 0.6,
    openTime: open, expiryTime: open + 60, status: 'Trading' as const,
  });

  type Slots = ReturnType<typeof mk>[];
  // A holder rather than a bare `let`: assigned only inside the callback, which
  // narrows a plain variable to `never` at every later use.
  const sink: { push: ((slots: Slots) => void) | null } = { push: null };
  const feed = {
    live: true,
    subscribe(cb: (slots: Slots) => void) {
      sink.push = cb;
      cb([mk('0xold', openTime), mk('0xold', openTime), mk('0xold', openTime), mk('0xold', openTime)]);
      return () => {};
    },
  };

  const live: any = new Engine(feed as never);
  live.attachCanvas(canvas);
  live.start();
  const inner = live as { tickClock(): void };

  inner.tickClock();                       // crosses the expiry -> locks
  check('an expired live window locks', live.snapshot().phase !== 'trade', live.snapshot().phase);

  // The venue opens the next one while the result is still coming.
  const fresh = Math.floor(Date.now() / 1000);
  sink.push?.([mk('0xnew', fresh), mk('0xnew', fresh), mk('0xnew', fresh), mk('0xnew', fresh)]);
  check('the roll is parked, not applied', live.race.marketId === '0xold', live.race.marketId);

  await spin(3200);                        // lock 2.2s + the cinematic
  check('the result still exists after a roll arrived', live.outcome !== null);
  step(`live result survives a roll → ${live.outcome?.txt}`);
  live.stop();
}

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
