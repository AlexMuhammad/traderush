# Findings against the live venue — 2026-08-29

Everything below was verified by running against Shannon and Somnia mainnet, or read from
`somnia-chain/dreamdex-bot-kit` `docs/event-contracts.md` and `packages/ec-core`. Each item
contradicts the build brief, so the brief is **not** the source of truth on these points.

Reproduce with `pnpm doctor` and `NETWORK=mainnet pnpm doctor`.

---

## 1. Event contracts are not on `GET /v0/markets` — the PRD's §2 premise is wrong

The brief says contract addresses and market state are "re-fetchable at runtime from
`GET /v0/markets`". They are not. That endpoint's `kind` parameter is an enum of
`["spot","perp","all"]` — **there is no binary tier on it at all**:

```
GET /v0/markets?kind=binary -> 400
  value is not one of the allowed values ["spot","perp","all"]
```

Both hosts (`stg.api.dreamdex.io` and `api.dreamdex.io`) return spot rows only — 3 on
staging, 4 on production, `kind: "spot"` on every one. `kind=perp` returns an empty list.
Unknown query params such as `tier=binary` or `status=Finalized` are silently ignored and
return the same spot list, which is how this looks like it works when it does not.

**Where binaries actually live:** the indexer, through
[`@somnia-chain/markets-sdk`](https://www.npmjs.com/package/@somnia-chain/markets-sdk)
(latest 0.28.1). `exchange.loadMarkets()` returns unified rows; binaries are
`type === "binary"`, scoped by `venueId`. Settled ones need
`client.listBinaryMarkets({ venueId, status: "Finalized" })`.

**Consequence:** venue addresses now come from a bundled per-network deployment map
(`packages/sdk/src/networks.ts`), which is what the bot kit itself does and for a stated
reason — `@somnia-chain/deployments` is private and not installable outside its monorepo.
Every address in the map is checked for code by `pnpm doctor`, so a stale entry fails loudly.

**Still open:** `MarketAdapter` does not yet read binaries. See "What is left" below.

---

## 2. Testnet collateral is 6 decimals, not 18

| | testnet | mainnet |
|---|---|---|
| chain id | 50312 | **5031** |
| collateral | tUSDC `0x70a86D…5d8E` | USDso `0x000000…008A` |
| **decimals** | **6** | **18** |
| faucet | yes, public `faucet(uint256)` | no |
| tick / lot | 1e3 / 1 | 1e15 / 1e15 |

Verified on-chain — `decimals()` on the testnet collateral returns `6`.

The first cut of the UI hardcoded `formatUnits(x, 18)` everywhere. On testnet that renders
every balance, stake and pot **a million times too small**: a 5 tUSDC stake displays as
`0.000005`. Now there is exactly one formatter (`useMoney` in `components/ui.tsx`) and it
takes decimals from the active network. `doctor` cross-checks the map against the token and
fails if they disagree.

The PRD says "USDso" throughout. That is the mainnet token; on testnet it is tUSDC.

---

## 3. Settlement is NOT automatic — the PRD's "no claim button" is backwards

Brief §6.2: *"No claim button anywhere. Settlement lands by itself; say so on S7."*

The bot kit says the opposite, in a section titled **"Winnings are claimed, not received"**:

> A settled market pays out only when someone asks it to. The position does not decay into
> collateral on its own, so a bot that trades for a week and never redeems has its balance
> spread across dozens of finalised markets while its wallet reads near zero.

Their own strategies call `maybeClaim` every loop because of this. Shipping the brief's copy
would have told a winner their money was on its way while it sat unclaimed indefinitely.

S7 now leads with the claim button and says the winnings are not automatic.

---

## 4. Market status 3 is `Settling`, not unused

The brief lists `0 Listed · 1 Trading · 2 Locked · 4 Resolved · 5 Voided` and calls 3 unused.
`ec-core/markets.ts` has `Settling: 3`. Treating it as unknown rendered a settling market as
`Listed` — i.e. as if it were about to open for trading.

---

## 5. Endpoint and gotcha corrections

- **RPC.** The kit uses `api.infra.{testnet,mainnet}.somnia.network`, not
  `dream-rpc.somnia.network`. Both answer on testnet; the former is the documented one.
- **`VENUE_ID` is required and moves.** One deployment hosts several venues and their markets
  sit side by side in the indexer. Both networks changed venue three times in the first week
  of August 2026. Defaults are in the map; if reads come back empty, take the id off a live row.
- **A reverted write does not throw.** SDK writes skip simulation and resolve even when the
  transaction reverted; the receipt rides on `info`. Not in the brief's gotcha list at all.
  Our `DuelAdapter` simulates before every write, which sidesteps this for duels.
- **Expiry headroom should scale to the window,** not be a flat 30s. A fixed 300s rejects
  every market on a venue running 5-minute windows; a flat 30s is too thin on long ones.
- **Tick/lot are not discoverable.** Binary rows carry no `tickSize`/`lotSize`, unlike spot.
  They are config, and they differ per network — the mainnet grid rejects every testnet order.

---

## 6. Every venue signature we transcribed was wrong

PRD §4.2 said "every signature is VERIFY". They were all wrong, and
`DuelEscrow.sol` calls three of them. The real ABIs are now re-exported from
`@somnia-chain/markets-sdk` rather than hand-copied, so this class of error
cannot recur.

| Assumed | Actual |
|---|---|
| `mintCompleteSet(bytes32 marketId, uint256 amount)` | `mintCompleteSet(uint32 operatorId, bytes32 venueId, bytes32 marketId, uint256 amount)` |
| `marketStatus(bytes32) → uint8` | **does not exist** |
| `outcomeIds(bytes32) → (uint256,uint256)` | **does not exist** |
| `redeem(bytes32, uint256 tokenId, uint256 amount)` | `redeem(uint32 operatorId, bytes32 venueId, bytes32 marketId, uint8 outcomeIdx, uint256 amount)` |

`markets(bytes32 marketId)` returns the whole record and supplies everything the
escrow needs in one call: `collateral, originOperatorId, originVenueId, pool,
yesId, noId, tradingStart, expiry`.

**There is no status enum on-chain.** Status is the trading window:
`tradingStart <= now < expiry`. Deriving it from the chain's own clock is
stronger than an indexed enum, and it satisfies gotcha §8.1 directly.

**`DuelEscrow.sol` cannot work as written** — it would deploy and then revert on
every `accept`. Reworking it against the real interface is the next contract
task, and it gets simpler: one `markets()` read replaces both `marketStatus()`
and `outcomeIds()`.

---

## 7. Reference-mode markets carry `strike: "0"`

Half the live markets resolve against a REFERENCE question rather than a strike
fixed at creation, and their `strike` field reads `"0"` until — and after — the
window opens. The opening price comes from `getOpeningPrices(marketIds)`.

Read naively, the strike is zero and the entire up/down question is meaningless.

Related: `strike` is documented as "raw, in the oracle's price scale", and that
scale is exposed nowhere. Parsing it out of the question text is what gotcha §8.9
forbids. `MarketDiscovery` infers it per asset by comparing the raw strike to the
live underlying price and rounding to the power of ten between them — measured as
1e2 on Shannon. Mainnet ships no bundled price feed, so confirm it there.

---

## What is left

1. **Rework `DuelEscrow.sol` against the real module interface** (finding 6). It cannot
   work as written. This is now the critical path.
2. **§9 unknowns #1 and #2** (`docs/UNKNOWNS.md`). #2 is the one that can still sink the
   design, and it needs two wallets and a resolved market.
3. **Deploy + `pnpm e2e`** — M3, still the real gate.
4. **Feed the game console from the SDK.** `console/engine/market.ts` is the only module
   that invents numbers; nothing in `console/components/` reads it directly.
