# §9 — Blocking unknowns

**Status: UNANSWERED.** These block contract logic, not follow it. Run `pnpm probe`
against a 15-minute market and fill this file in on day 1. Nothing downstream is
trustworthy until all three have a written answer here.

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

## #3 How are `upId` / `downId` derived from `marketId`?

- **Answer:** _(unanswered)_
- **Evidence:** _(does `outcomeIds()` exist? if not, what does packages/core do?)_
- **Tested on:** _(date, marketId)_

**If `outcomeIds()` does not exist:** read the derivation out of
`github.com/somnia-chain/dreamdex-bot-kit` `packages/core` and adjust
`IBinaryMarketsModule` plus `packages/sdk/src/abi.ts`. The ids may derive as
`keccak(marketId, outcome)` or live inside the `markets(marketId)` record.

---

## Non-blocking

**Are BTC/ETH event-contract markets live on Shannon, and with what depth?**

- **Answer:** _(unanswered — `pnpm doctor` prints this)_

Duels do not need depth; solo book trading does.
