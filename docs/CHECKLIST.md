# Definition of done (§11)

- [ ] Two people on two devices complete a duel on Shannon testnet end to end
- [x] Every §4.3 test passes — `pnpm test:contracts`, 25/25 green against mocks that
      mirror the real module interface, not the transcribed one
- [x] Every §8 gotcha is implemented, with a comment naming which one — see README table
- [ ] Unmatched duel refunds exactly, verified on-chain — `pnpm e2e` asserts it; needs a live run
- [x] Voided market renders as "called off", not a loss — `apps/web/src/screens/Result.tsx`
- [x] No simulated data anywhere in the app — the REST normalizer throws rather than substituting
- [x] Repo public-ready, `.env.example` present, no keys in history
- [x] README states unaudited/testnet-only, the split-merge prior art, and that builder fees
      apply to book orders only

# Milestones (§10)

| # | Deliverable | State |
|---|---|---|
| M1 | Environment + unknowns | **done** — `doctor` prints a live market list; §9 #3 answered, #1/#2 owed |
| M2 | `DuelEscrow` + tests | **done** — 25/25, reworked against the real module ABI |
| M3 | Deployed + e2e script | `pnpm e2e` written; needs a deploy and a live run. **The real gate.** |
| M4 | Session keys | not started — wire an `OrderSubmitter` from dreamdex-bot-kit `packages/core` |
| M5 | SDK market adapter | **done** — S2/S3 render live off it |
| M6 | SDK duel adapter + S4–S8 | **done** — needs the live run to confirm |
| M7 | Edge cases | covered in tests; needs on-chain confirmation |

# Known open ends

1. **§9 unknowns are unanswered.** Resolve before trusting the escrow's mint path.
2. **Venue ABIs are no longer transcribed.** They come from `@somnia-chain/markets-sdk`,
   generated from the deployed contracts. Every hand-copied signature had been wrong; see
   `docs/FINDINGS.md` finding 6.
3. **Market discovery runs off the indexer**, not the REST registry, which serves spot and
   perp only.
4. **Book trading needs an `OrderSubmitter`.** `MarketAdapter.buy/sell` snap, guard and
   preflight correctly but delegate the signed-order transport, which should come from the bot
   kit rather than be rewritten. Duels do not need it.
