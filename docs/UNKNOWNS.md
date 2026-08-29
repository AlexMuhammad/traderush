# §9 — Blocking unknowns

**Status: ALL THREE ANSWERED. The duel design holds.** Verified end to end on
Shannon on 2026-08-29 — two wallets, one duel, a real payout.

---

## #1 Can a contract call `mintCompleteSet` while holding user funds? — ANSWERED: YES

- **Answer:** Yes. `DuelEscrow` — a contract, holding both parties' stakes — called
  `mintCompleteSet(operatorId, venueId, marketId, 2S)` and received the pair. The
  module is caller-funded, and a contract is a perfectly good caller. It needs an
  ERC-20 allowance to the module, which the escrow sets with `forceApprove`
  immediately before the call.
- **Evidence:** `accept` on Shannon,
  `0x02a08b3ac365d3cc0b5dcdbc83aaecf1b2261d2e9079770ab659bd3edacf4f92`.
  Escrow `0xbfaaf7b082c5b39dedbb9f9224b6a435bda03a57`, market `0x…c3ff`.
  After it: challenger held 2S of UP, opponent 2S of DOWN, escrow zero collateral.
- **Tested on:** 2026-08-29, Shannon testnet.

**The §4.4 swap fallback is not needed.** The §4 design stands as written.

Note for anyone reproducing it: an EOA mint reverts with no reason string when the
module has no allowance. That is not access control, it is the `transferFrom`
inside — approve first.

---

## #2 Can any ERC-6909 holder redeem a winning leg? — ANSWERED: YES

- **Answer:** Yes — through `BinarySettlement.redeem(outcomeId, amount, to)`. It
  pays against the outcome id itself and does not care who minted it. That is
  exactly the primitive the duel needs.

  It matters WHICH path: `binaryModule.redeem(...)` reverts once the market is
  finalized and its pool released. Both were simulated side by side; only the
  settlement path works. See `docs/FINDINGS.md` finding 9.

- **Evidence:** market `0x…c3ff` (BTC 1h) resolved DOWN. The escrow
  `0xbfaaf7b0…` minted the set; neither wallet minted anything.

  | | before | after | |
  |---|---|---|---|
  | B, held DOWN (winner) | 19,999 | **20,001** | +2 tUSDC — the whole pot, on a 1 stake |
  | A, held UP (loser) | 19,999 | 19,999 | 0, **without reverting** (§11) |

  Winner `0xd3b6cebca8252c2b8643fe1bb8a629e579dbfe26ac8de0d771aac91dc9df57e9`,
  loser `0x8d751818ebaae82b3051faadff7ee442baaea6de16a6824ed7c23d7af309671f`.
- **Tested on:** 2026-08-29, Shannon testnet.

**The duel design holds.** A leg minted by the escrow and transferred out is
redeemable by whoever holds it, which is the whole basis of the product.

**If NO: the duel design collapses. Escalate immediately.** The whole product depends on
a transferred leg being redeemable by whoever holds it.

Procedure (needs two wallets and a resolved market):
1. A mints a complete set on a 15m market.
2. A transfers the UP leg to B.
3. Wait for the window to resolve.
4. B calls `redeem(marketId, upId, n)`.

---

## #3 How are `upId` / `downId` derived from `marketId`? — ANSWERED

- **Answer:** They are not derived from `marketId` at all. They derive from the
  POOL and its nonce:

  ```
  id = (uint160(pool) << 72) | (nonce << 8) | idx        idx: 0 = UP/YES, 1 = DOWN/NO
  ```

  In practice nothing has to compute it. Both ids are carried on every indexed
  market row as `yesTokenId` / `noTokenId`, and the on-chain record
  `binaryModule.markets(marketId)` returns them as `yesId` / `noId`.

  `outcomeIds(bytes32)` does **not** exist on the module.

- **Evidence:** `outcomeId(pool, nonce, idx)` from `@somnia-chain/markets-sdk`
  reproduces the indexer's ids exactly, checked across ten live Shannon markets.
  Example: pool `0xb20dd6a2…`, nonce 42, idx 0 →
  `4800327862127088248229621037605621891398115974915084856122694860548608`,
  identical to the row's `yesTokenId`. The chain agrees: `markets()` returns the
  same pair.
- **Tested on:** 2026-08-29, Shannon testnet.

**Consequence:** pools are recycled, so `(pool, nonce)` — not the pool alone — is
what identifies a window. This is the mechanism behind gotcha §8.6.

---

## Non-blocking — ANSWERED

**Are BTC/ETH event-contract markets live on Shannon, and with what depth?**

- **Answer:** Yes. Both assets, on two venues. On operator 2's venue
  (`0x679795a0…`, the one in `networks.ts`): 6 live markets at 1h, 4h and 24h.
  Operator 4's venue also runs 60s and 300s windows. Books carry resting orders
  on both sides for most markets; the 24h ones often have an ask but no bid.
- **Tested on:** 2026-08-29 via `pnpm doctor`.

Duels do not need depth; solo book trading does.
