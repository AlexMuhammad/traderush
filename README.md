# TRADE RUSH

A peer-to-peer duel layer on top of DreamDEX Event Contracts.

Normally you trade an Up/Down event contract against the order book. TRADE RUSH adds a second
path: **two specific people put up equal stakes, a contract mints the pair for them, and the
winner takes the pot.** No order book, no market maker, no liquidity requirement.

> **Unaudited.** Built and tested on Shannon testnet (chain `50312`). A mainnet path exists
> and is one config line away, but nothing here has been audited — do not point it at real
> funds without one.

Split/merge is a standard primitive — Polymarket has had `splitPosition` / `mergePositions`
since launch. Our contribution is the product layer on top of it: the challenge, the link, the
lobby, and the settlement view. **Builder fees apply to book orders only, never to duels.**

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
apps/web            base front end — plain, functional, no game art
packages/contracts  DuelEscrow.sol + forge tests + deploy script
packages/sdk        market adapter (read/write) + duel adapter (escrow)
packages/scripts    doctor, §9 probe, two-wallet e2e
docs/UNKNOWNS.md    the three §9 blocking unknowns — fill these in on day 1
docs/FINDINGS.md    where the build brief is wrong, verified against the live venue
```

**Read `docs/FINDINGS.md` before the brief.** Five of the brief's stated facts do not hold
against the live venue — including where event contracts are discoverable, the collateral's
decimals, and whether settlement is automatic (it is not).

**The front end never talks to the chain or the socket directly. It talks to the SDK.**
This is non-negotiable: the polished game console is swapped in later against the same SDK
surface, so any number that is wrong here would be wrong there too.

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
pnpm e2e                  # the whole journey on live testnet, in one run
pnpm settle               # settle a specific duel:  DUEL_ID=4 pnpm settle
pnpm dev                  # http://localhost:5173
```

`pnpm e2e` walks the same code the browser walks — the discovery the dials read,
the allowance the create screen surfaces, the deadline bounds it enforces, the
blocker list the accept screen renders, the settlement path the payout screen
calls — and it does it with real transactions against live markets. It waits for
a window to close, so it takes as long as one short market.

It does **not** cover React rendering or Privy's login UI. Everything below the
wallet client is exercised for real; the two things above it are not.

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
