/** Gotcha §8.2 / §8.3 — float prices revert.
 *
 *  `(0.05).toFixed(18)` is three wei off the tick grid on an 18-decimal venue and is
 *  rejected with InvalidPrice. Of fifteen ordinary probabilities only 0.25, 0.5 and 0.75
 *  survive the round trip. So: never send a formatted float. Snap to whole ticks and
 *  send a bigint. */

/** Snap a 0..1 probability to the nearest whole tick, returned as base units. */
export function snapPrice(probability: number, tickSize: bigint, decimals = 18): bigint {
  if (!(probability > 0 && probability < 1)) {
    throw new Error(`price must be strictly between 0 and 1, got ${probability}`);
  }
  const scale = 10n ** BigInt(decimals);
  // Round in integer space; never via toFixed.
  const raw = BigInt(Math.round(probability * Number(scale)));
  const ticks = (raw + tickSize / 2n) / tickSize;
  const snapped = ticks * tickSize;
  if (snapped <= 0n || snapped >= scale) {
    throw new Error(`price ${probability} snapped outside (0,1)`);
  }
  return snapped;
}

/** Snap an order size down to the lot grid.
 *  Gotcha §8.3 — if it rounds to zero, SKIP. Never send a zero-size order. */
export function snapSize(amount: bigint, lotSize: bigint): bigint | null {
  if (lotSize <= 0n) return amount > 0n ? amount : null;
  const snapped = (amount / lotSize) * lotSize;
  return snapped > 0n ? snapped : null;
}

/** Gotcha §8.4 — order expiry is mandatory; it doubles as a dead-man's switch.
 *  Set it just past the requote interval. */
export function expireTimestampNs(secondsFromNow: number, now = Date.now()): bigint {
  return BigInt(Math.floor(now + secondsFromNow * 1000)) * 1_000_000n;
}

/** Gotcha §8.11 — acceptDeadline must be at least 30s before expiry, otherwise the
 *  accept lands in a locking market and reverts inside mintCompleteSet, burning gas
 *  for both parties. The UI default is expiry - 60s (§6.1 S4). */
export const MIN_DEADLINE_MARGIN_SEC = 30;
export const DEFAULT_DEADLINE_MARGIN_SEC = 60;

export function defaultAcceptDeadline(expiryTimeSec: number): number {
  return expiryTimeSec - DEFAULT_DEADLINE_MARGIN_SEC;
}

export function assertDeadlineSafe(acceptDeadlineSec: number, expiryTimeSec: number): void {
  if (acceptDeadlineSec > expiryTimeSec - MIN_DEADLINE_MARGIN_SEC) {
    throw new Error(
      `acceptDeadline must be at least ${MIN_DEADLINE_MARGIN_SEC}s before expiry (gotcha §8.11)`,
    );
  }
}

/** Gotcha §8.5 — prefer IOC for taker flow. An unfilled remainder rests on the book
 *  with escrow locked, invisibly, unless you track open orders. */
export const DEFAULT_TIME_IN_FORCE = 'IOC' as const;

/** §6.2 — the UI must disable trade/accept a few seconds before expiry, not at zero. */
export const UI_FREEZE_SEC = 5;
