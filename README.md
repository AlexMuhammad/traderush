# TRADE RUSH

Three ways to take a side of a DreamDEX Event Contract, wearing a handheld console.

**The run** is the front page: you buy the contract on the venue's own book. The market is
your counterparty, the fill is immediate, and nobody has to turn up.

**Rooms** are the second path, and the one an order book cannot give you. Everyone stakes into
one pot and the winning side splits the whole of it by what each of them put in — five against
three pays the three side more. No market maker, no liquidity requirement, no waiting to be
matched at your exact size.

**Duels** are a room with two people and equal stakes: a challenge, a link, and a winner who
takes the pot.

> **Unaudited.** Built and tested on Shannon testnet (chain `50312`). A mainnet path exists
> and is one config line away, but nothing here has been audited — do not point it at real
> funds without one.

Split/merge is a standard primitive — Polymarket has had `splitPosition` / `mergePositions`
since launch. Our contribution is the product layer on top of it: the challenge, the link, the
lobby, the settlement view, and a console where the market IS the game — the strike is a line,
the two animals hold the ground either side of it, and you are the thing running along it.

**A builder fee is off unless configured, and can only ever apply to book orders** — a room or
a duel never touches one. See `BUILDER_ADDRESS` in `.env.example`.

---

## How a duel works

Each side stakes `S`. Pot = `2S`. The escrow mints `n = 2S` complete sets, costing `2S`
collateral, producing `2S` Up and `2S` Down. One leg goes to each party. The winner redeems
`2S` — the whole pot. The loser's leg redeems 0 and must not revert.

Minting `n = S` is the classic mistake: it pays the winner half the pot and strands the rest.

If nobody accepts, `cancel` refunds the challenger exactly `S`. Nothing was ever minted, so an
unmatched challenge never puts funds at risk.

---

## Networks — switching is one line

Nothing in the source names a chain. Everything network-specific lives in
`packages/sdk/src/networks.ts` and resolves through `loadConfig()`:

```bash
NETWORK=testnet   # chain 50312, tUSDC, 6 decimals, faucet     (default)
NETWORK=mainnet   # chain 5031,  USDso, 18 decimals, real money
```

Chain id, RPC, indexer, collateral address, **decimals**, tick/lot grid, explorer and venue id
all follow from it. Each network gets its own escrow deploy
(`DUEL_ESCROW_ADDRESS_TESTNET` / `_MAINNET`), so one `.env` can hold both and the switch can
never point at the wrong one. Duel links carry the chain id, so a testnet link refuses to open
against a mainnet build.

Verify either one before trusting it:

```bash
pnpm doctor                  # testnet
NETWORK=mainnet pnpm doctor  # mainnet
```

`doctor` checks every mapped address actually has code on the chain, and cross-checks the
collateral's real `decimals()` against the map — a stale entry fails loudly instead of
quietly mis-rendering every amount.

> Collateral is **6 decimals on testnet** and 18 on mainnet. Never hardcode 18: the UI
> formats through one helper that reads the active network.

## Layout

```
apps/web            the console — canvas engine, screens, wallet
packages/contracts  DuelEscrow.sol + RoomEscrow.sol + forge tests + deploy
packages/sdk        market reads, book orders, and the two escrow adapters
packages/scripts    doctor, probes, market maker, three e2e journeys
docs/UNKNOWNS.md    the three §9 blocking unknowns — fill these in on day 1
docs/FINDINGS.md    where the build brief is wrong, verified against the live venue
```

**Read `docs/FINDINGS.md` before the brief.** Five of the brief's stated facts do not hold
against the live venue — including where event contracts are discoverable, the collateral's
decimals, and whether settlement is automatic (it is not).

**Every write goes through the SDK, and every price a person acts on comes from the chain.**
Not from the indexer: on a live market the two read 95.40/97.80 against a real 96.40/98.50, and
a point is nothing on a list and everything on a control — it decides whether a key can fill
and what number it promises. The indexer lists markets; the pool prices them.

---

## Wallets

Connection goes through [Privy](https://privy.io): email, a social account, or an
injected wallet, with an embedded wallet created for anyone who arrives without
one. What the app receives is a plain viem `WalletClient` either way, so nothing
downstream knows how the person got there.

Set `VITE_PRIVY_APP_ID` — the **public** app id, which ships in the browser
bundle by design. Without it everything still runs (the console's demo needs no
wallet) and anything that would sign says why.

> The Privy **app secret** is a server credential and this repo has no server
> (§12). It must never appear in `.env`, in a commit, or in a shell command.
> Anything holding it can act as your app; if one has been exposed, rotate it.

## Setup

```bash
cp .env.example .env      # fill in RPC/REST/WS and two testnet keys
pnpm install
pnpm test:contracts       # 20 tests, no network
pnpm doctor               # prints the LIVE market list and the venue addresses
```

`doctor` must print a live market list before anything else is worth doing (M1).

### Deploy the escrow

Contract addresses are **re-fetched at runtime from `GET /v0/markets`** and are never
hard-coded. `doctor` prints the exact deploy command with them filled in:

```bash
COLLATERAL=0x… MODULE=0x… OUTCOME=0x… pnpm deploy:escrow
```

Put the resulting address in `.env` as `DUEL_ESCROW_ADDRESS` and `VITE_DUEL_ESCROW_ADDRESS`.

### The gate

```bash
pnpm faucet               # tUSDC into both test wallets
pnpm e2e                  # a duel, end to end, on live testnet
pnpm e2e:room             # a room: two players, uneven sides, floating payout
pnpm e2e:book             # the front page: buy on the book, wait, redeem
pnpm settle               # settle a specific duel:  DUEL_ID=4 pnpm settle
pnpm dev                  # http://localhost:5173
```

Each e2e walks the same code the browser walks and does it with **real transactions against
live markets**, waiting for a real window to close. Between them they cover the three paths:
`e2e` the duel escrow, `e2e:room` the parimutuel split, `e2e:book` the venue's order book —
including the assertion that matters most, that a losing contract redeems for nothing *without
reverting*, because a revert there strands the loser on an error forever.

They do **not** cover React rendering or Privy's login UI. Everything below the wallet client
is exercised for real; the two things above it are not.

### When the book is thin

```bash
pnpm probe:book           # would an order cross right now? prints the maths
pnpm probe:order          # place one minimum lot and report what happened
pnpm maker -- --watch     # post two-sided quotes and keep them fresh
```

Short windows turn over faster than a transaction confirms, so an order there can arrive to
find its level gone — measured on testnet, a sixty second book filled three orders in six while
five minutes filled five in five. The console therefore **opens** on a window of five minutes
or more; every interval stays reachable on the dials.

`pnpm maker` is the other half of the answer, and the half nothing else here was using: the
venue pays yield for posting tight quotes, and everything else in this repo only ever took.
It quotes **both** sides, which takes inventory — a bid escrows collateral, an ask escrows the
outcome token itself — so it mints a complete set on each pool first and burns what is still
paired on the way out. Capital borrowed for the run comes home; capital that became a trade
stays a trade.

This is also the honest answer to what a room does NOT do. Rooms and duels mint their sets
directly and never touch the book, which is the point — a parimutuel pot needs no counterparty
— but it means they add no depth to the venue they are built on. The maker is where this
project puts liquidity back.

---

## Screens

| | | |
|---|---|---|
| S1 | Connect | wallet, USDso balance, network guard, one-time approval |
| S2 | Markets | live table; row click → S3 |
| S3 | Market | strike, spot, delta, up/down with multiplier, countdown, status |
| S4 | Create duel | side, stake, pot, payout, accept deadline → `open()` → link |
| S5 | Lobby | link + copy, countdown, waiting/matched/expired, Cancel |
| S6 | Live duel | both parties, pot, spot vs strike, who is winning. Read-only |
| S7 | Result | winner, amount, redeem if not auto-redeemed, oracle link |
| S8 | Accept | opened from the link; terms and one Accept button, fully guarded |

Winnings are **claimed, not received** — a settled market pays only when someone asks it to,
so S7 leads with the claim button. The build brief says the opposite; see `docs/FINDINGS.md`.

---

## Gotchas implemented

Every one of these silently produces wrong behaviour rather than an obvious error. Each is
implemented with a comment naming its number.

| # | Gotcha | Where |
|---|---|---|
| 1 | Read on-chain status before every write — the indexer lags | `DuelEscrow.open/accept`, `MarketAdapter.assertTradingOnChain`, `DuelAdapter` simulates |
| 2 | Float prices revert; snap to whole ticks and send a `bigint` | `sdk/src/ticks.ts` `snapPrice` |
| 3 | Snap size to the lot grid; if it rounds to zero, **skip** | `sdk/src/ticks.ts` `snapSize` |
| 4 | Order expiry is mandatory — a dead-man's switch | `ticks.ts` `expireTimestampNs` |
| 5 | Prefer IOC for taker flow | `ticks.ts` `DEFAULT_TIME_IN_FORCE` |
| 6 | Never key state by pool address — pools are recycled | `MarketAdapter` cache, `Markets.tsx` row keys |
| 7 | Reconcile against the wallet, not the vault | `MarketAdapter.balance`, `Connect.tsx` |
| 8 | `loadMarkets()` hides settled markets | `RestClient.listFinalizedMarkets` |
| 9 | Read `asset` and `intervalSec` as typed fields, never regex the question | `rest.ts` `normalizeMarket` |
| 10 | Voided pays both sides 0.5 — render as "called off" | `Result.tsx` |
| 11 | `acceptDeadline` must be ≥ 30s before expiry | `ticks.ts` `assertDeadlineSafe`, `CreateDuel.tsx`, `AcceptDuel.tsx` |

The UI also disables trade/accept a few seconds **before** expiry rather than at zero, and
dims a stale readout on socket drop instead of showing a frozen price.

---

## Before you write contract logic

`docs/UNKNOWNS.md` holds the three §9 blocking unknowns. They cannot be answered from
documentation and are cheap to test:

```bash
pnpm probe
```

Answer all three in writing before touching the escrow's mint path. If #2 comes back NO, the
duel design collapses — escalate rather than working around it.

---

## Out of scope

Game console visuals, animation, sound. Leaderboards, points, tokens. Mainnet. Mobile apps.
Chat. Tournaments. Our own order matching. Anything requiring a backend service.
