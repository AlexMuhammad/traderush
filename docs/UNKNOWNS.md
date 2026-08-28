# §9 — Blocking unknowns

**Status: #3 ANSWERED. #1 and #2 still open.** Run `pnpm probe` and fill the rest
in. Nothing downstream is trustworthy until each has a written answer here.

---

## #1 Can a contract call `mintCompleteSet` while holding user funds, or is it caller-funded only?

- **Answer:** _(unanswered)_
- **Evidence:** _(tx hash / eth_call result / revert data)_
- **Tested on:** _(date, marketId)_

**If NO:** switch to the §4.4 swap fallback — the challenger mints their own set
off-contract, the escrow holds the opponent's stake plus one leg, and on accept swaps
leg-for-stake. More steps, same guarantees, no new unknowns. **Decide by day 2.**

---

## #2 Can any ERC-6909 holder redeem a winning leg, or only the original minter?

- **Answer:** _(unanswered)_
- **Evidence:** _(tx hash of wallet B redeeming a leg minted by wallet A)_
- **Tested on:** _(date, marketId)_

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
