# Definition of done (§11)

- [ ] Two people on two devices complete a duel on Shannon testnet end to end
- [x] Every §4.3 test passes — `pnpm test:contracts`, 20/20 green against mocks
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
| M1 | Environment + unknowns | `pnpm doctor` written; §9 answers still owed in `docs/UNKNOWNS.md` |
| M2 | `DuelEscrow` + tests | **done** — 20/20 |
| M3 | Deployed + e2e script | `pnpm e2e` written; needs a deploy and a live run. **The real gate.** |
| M4 | Session keys | not started — wire an `OrderSubmitter` from dreamdex-bot-kit `packages/core` |
| M5 | SDK market adapter | **done** — S2/S3 render live off it |
| M6 | SDK duel adapter + S4–S8 | **done** — needs the live run to confirm |
| M7 | Edge cases | covered in tests; needs on-chain confirmation |

# Known open ends

1. **§9 unknowns are unanswered.** Resolve before trusting the escrow's mint path.
2. **Venue ABIs are VERIFY.** `IBinaryMarketsModule` and `IOutcomeToken6909` were transcribed
   from documentation. Confirm against dreamdex-bot-kit `packages/core` before deploying.
3. **The REST payload shape is unverified.** `normalizeMarket` reads typed fields with
   fallbacks and throws with the raw payload named when a required field is missing — `doctor`
   prints that payload so the normalizer can be corrected in one pass.
4. **Book trading needs an `OrderSubmitter`.** `MarketAdapter.buy/sell` snap, guard and
   preflight correctly but delegate the signed-order transport, which should come from the bot
   kit rather than be rewritten. Duels do not need it.
