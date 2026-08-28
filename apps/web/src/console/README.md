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

## Simulated data

`engine/market.ts` is the only module that invents numbers. Everything else
consumes a `Race`. Wiring this to the real venue means replacing that module and
feeding `Race` from the SDK's `MarketState`; no component changes.
