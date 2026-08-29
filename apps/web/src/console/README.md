# THE RUN — game console

The polished front end, refactored out of the single-file prototype. Behaviour is
unchanged: same simulation, same animations, same sounds.

## The split

```
GameConsole.tsx     wires the two halves together
components/         the chrome — plain React, driven by one snapshot object
engine/             all state, the canvas, the audio. React never enters here.
console.css         the panel styling
```

**The rule:** the engine owns everything and paints the canvas at animation-frame
rate; React renders the chrome from a `ConsoleSnapshot` the engine publishes when
something a human would notice changes. The chrome's only way to affect the world
is to call an engine action. There is no second copy of the state to keep in step,
and a React re-render never touches the canvas.

## engine/

| File | What lives there |
|---|---|
| `engine.ts` | `Engine` — state, timers, the window lifecycle, the resolve sequence, actions |
| `render.ts` | `renderScene` — one frame: territories, trail, animals, HUD, overlays |
| `beasts.ts` | Idle behaviour. A move state machine gated by an aggression value |
| `cinematics.ts` | The three finish-line sequences: `gore`, `claw` (losses), `stand` (win) |
| `sprites.ts` | Every pixel-art figure, drawn as rectangles around a foot-level origin |
| `audio.ts` | One `AudioContext`, a continuous bed, and every one-shot |
| `market.ts` | The four races and the price/odds simulation |
| `fx.ts` | Particles, shockwave rings, claw slashes |
| `types.ts` | Shared shapes, including the `ConsoleSnapshot` contract |

## The screen is a display, not just a canvas

`Window` takes an optional `screen` node rendered inside `.crt` — above the
canvas, **below** `.scan`. That ordering is the whole trick: the scanlines and
the corner falloff fall across the content, so a market listing reads as
phosphor rather than as a web page pasted over the glass.

The canvas stays mounted underneath. Coming back to the game is instant, and
the engine already skips painting a detached canvas.

The menu switches what is on the screen rather than navigating away, so the
plate, the dials and the keys never leave. Markets is the first of these; the
duel flows are still panels below the face.

## Things worth knowing before editing

**The animals cannot cross the strike line.** The bull is clamped above it, the
bear below. That invariant is what makes the picture readable at a glance — you
are the only thing that moves between territories. It is enforced in `render.ts`
where `bullY`/`bearY` are clamped, not left to the behaviour code.

**Aggression is a curve, not a mode.** `aggressionFor(progress)` in `render.ts`
returns four bands across the window. The same behaviour code grazes early and
bellows at the end; there is no separate "endgame" branch to keep in sync.

**Keys are two layers.** `.housing` is the well, `.cap` is the part that moves.
Depth is a hard skirt (`0 Npx 0 <colour>`), and pressing shrinks the skirt by
exactly the travel, so the key's bottom edge stays put. See the comment at the
top of `console.css`.

**Audio needs a gesture.** `engine.wake()` is called from every key press;
`Audio.start()` is idempotent and does nothing until then. Browsers refuse to
open an `AudioContext` any earlier.

**Timeouts are tracked.** The cinematics schedule a dozen sounds and flashes.
`Engine.later()` records them so `stop()` can cancel the lot — otherwise a
sequence outlives the component and fires into a dead canvas.

## Testing it

```bash
pnpm smoke
```

Drives the real `Engine` against a stubbed canvas: idle, trading into danger,
all three cinematics through their full timelines, a window resolving with the
real timers running out, tuning across all four races, board/bail, the speed
cycle, and teardown.

It asserts invariants, never values — the simulation is random by design, so
anything keyed to a particular price would flake. It exists because `tsc` cannot
see the failures that actually happen here: a null read inside a timer, an index
walking off a keyframe table, a cinematic branch a normal session reaches once.
It has already caught a crash that survived a full typecheck and a clean build.

It is not a substitute for looking at the thing. It proves the engine does not
throw and that the state transitions hold; it says nothing about whether the
animals look right.

## Where the numbers come from

The engine takes a `MarketFeed`. There are two, and nothing else in the engine
knows which one it is looking at:

| | |
|---|---|
| none (demo mode) | `engine/market.ts` simulates four races |
| `engine/feed.ts` | real event contracts from the indexer |

`LiveFeed` picks a 2×2 that matches the tuner — each asset at its two shortest
live intervals — and folds each reading onto the dials. The engine keeps `hist`,
`pos` and the cinematics; the chain owns strike, spot, odds and the window.

Three things follow from the markets being real:

- **The tuner's labels are read, not assumed.** The venue runs 1H/4H/24H
  windows; the prototype's fixed 15M/1H would have been a dial that lies about
  its own interval.
- **Demo speed does not apply.** `t` is wall-clock against the market's own
  window, because the chain does not care how fast you are watching.
- **The console never rolls a live window.** The venue opens the next one, which
  may be an hour away, so the result stays up and the status says it is waiting.

The keys still stake points, not money — the console places no real orders. The
footer says LIVE PRICES or DEMO PRICES so the two are never confused.
