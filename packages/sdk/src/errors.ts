/**
 * Wallet and contract failures, said in a sentence.
 *
 * viem's errors are written for whoever has to debug the call: a rejection in
 * MetaMask arrives as five lines of chain id, addresses, function signature and
 * the whole calldata. That is the right thing to keep and the wrong thing to put
 * on a screen — someone who pressed "reject" already knows what they did, and
 * everyone else learns nothing from a hex blob.
 *
 * So each known failure gets a title saying what happened and, where there is
 * one, a next step. The original text is never discarded; the UI keeps it behind
 * a disclosure so a bug report can still carry it.
 */
export interface Explained {
  /** One sentence, plain language. */
  title: string;
  /** What to do about it, when there is something to do. */
  detail?: string;
  /** viem's own text, for the details disclosure and for logs. */
  raw: string;
  /** True when the person chose this — not a fault, and not worth alarming them. */
  benign?: boolean;
}

/** Matched against the whole error text, first hit wins, so order matters. */
const RULES: { when: RegExp; title: string; detail?: string; benign?: boolean }[] = [
  // --- the person's own choice ---------------------------------------------
  {
    when: /User rejected|User denied|ACTION_REJECTED|\b4001\b/i,
    title: 'You cancelled this in your wallet.',
    detail: 'Nothing was sent and nothing was charged.',
    benign: true,
  },

  // --- the book, which moves under you --------------------------------------
  {
    when: /ImmediateOrCancelNoFill/i,
    title: 'The book moved before your order landed.',
    // Said without naming a direction: the same revert is a buy that found no
    // offer and a sell that found no bid, and "nothing was bought" is plainly
    // wrong on the way out.
    detail:
      'Nothing changed hands and nothing was charged — the resting order it was '
      + 'aiming at was gone by the time the transaction confirmed. Short windows '
      + 'turn over fastest; press again, or use one with more time left.',
    benign: true,
  },
  {
    when: /OrderExpiryBeyondMarket/i,
    title: 'That order would outlive the window.',
    detail: 'Nothing was sent. Try again — the expiry is clamped to the market now.',
  },
  {
    when: /InvalidQuantity|QuantityBelowMinimum/i,
    title: 'That size is off this book\'s grid.',
    detail: 'Raise the amount a little — the pool only accepts whole lots.',
  },
  {
    when: /nothing offered on this side|nobody bidding on this side/i,
    title: 'Nobody is on the other side of that yet.',
    detail: 'Nothing was sent. Take the other side, or wait for a quote.',
    benign: true,
  },

  // --- money and permission ------------------------------------------------
  {
    when: /ERC20InsufficientAllowance|insufficient allowance/i,
    title: 'The escrow is not allowed to move your stake yet.',
    detail: 'Press Approve first — it is asked once per wallet.',
  },
  {
    when: /ERC20InsufficientBalance|transfer amount exceeds balance/i,
    title: 'Your balance will not cover that stake.',
    detail: 'Lower the amount, or top up from the faucet.',
  },
  {
    when: /insufficient funds for (gas|intrinsic)|InsufficientFunds/i,
    title: 'Not enough native token to pay for gas.',
    detail: 'The stake is one thing; the transaction fee is another. Fund the wallet with STT.',
  },

  // --- the escrows' own rules ----------------------------------------------
  { when: /\bStakeZero\b/, title: 'Enter a stake above zero.' },
  {
    when: /\bEntryClosed\b/,
    title: 'Entry to this room has already closed.',
    detail: 'It shut partway through the window so nobody could join late and take almost no risk.',
  },
  {
    when: /\bEntryOpen\b/,
    title: 'Entry is still open, so there is nothing to settle yet.',
    detail: 'Wait for the entry deadline to pass.',
  },
  {
    when: /\bNothingToClaim\b/,
    title: 'There is nothing here for you to claim.',
    detail: 'Either you backed the losing side, or you have claimed already.',
  },
  {
    when: /\bRoomIsContested\b/,
    title: 'Both sides are backed, so this cannot be refunded.',
    detail: 'It settles on the market instead — come back when the window closes.',
  },
  {
    when: /\bRoomIsOneSided\b/,
    title: 'Only one side was ever backed, so there is no bet to settle.',
    detail: 'Take the refund instead.',
  },
  { when: /\bNoRoom\b/, title: 'That room does not exist on this escrow.' },
  { when: /\bNotOpen\b/, title: 'This duel is no longer open.', detail: 'Someone accepted it, or it was cancelled.' },
  { when: /\bSelfDuel\b/, title: 'You cannot take the other side of your own duel.' },
  { when: /\bNotChallenger\b/, title: 'Only whoever opened this duel can cancel it.' },
  { when: /\bDeadlinePassed\b/, title: 'The deadline for accepting has passed.' },
  {
    when: /\bDeadlineInPast\b/,
    title: 'That entry deadline is already behind us.',
    detail: 'Pick a later point in the window.',
  },
  {
    when: /\bDeadlineTooLate\b/,
    title: 'That entry deadline sits too close to the window closing.',
    detail: 'Choose an earlier fraction of the window.',
  },
  {
    when: /\bMarketNotTrading\b/,
    title: 'This market has stopped trading.',
    detail: 'Its window closed while you were on this screen. Pick a live one.',
  },
  { when: /\bMarketUnknown\b/, title: 'The venue does not recognise that market.' },
  { when: /\bWrongCollateral\b/, title: 'This market settles in a different token than the escrow holds.' },

  // --- network and node ----------------------------------------------------
  {
    when: /chain (mismatch|does not match)|ChainMismatch|does not match the target chain/i,
    title: 'Your wallet is pointed at a different network.',
    detail: 'Switch it to Somnia Shannon Testnet and try again.',
  },
  {
    when: /replacement transaction underpriced|nonce too low|already known/i,
    title: 'An earlier transaction from this wallet is still pending.',
    detail: 'Wait for it to confirm, then try again.',
  },
  {
    when: /HttpRequestError|fetch failed|timed? ?out|ECONNREFUSED|Failed to fetch|network ?error/i,
    title: 'The network did not answer.',
    detail: 'Nothing was sent. Check your connection and try again.',
  },
  {
    when: /rate ?limit|429/i,
    title: 'The node is rate limiting us.',
    detail: 'Give it a few seconds.',
  },
  {
    when: /gas required exceeds|out of gas|intrinsic gas too low/i,
    title: 'The transaction ran out of gas.',
    detail: 'Somnia estimates low for these calls. Try again.',
  },
];

/** Turn anything thrown into something a person can read. */
export function explainError(e: unknown): Explained {
  const raw = e instanceof Error ? (e.stack ?? e.message) : String(e);
  const text = e instanceof Error ? `${e.name} ${e.message} ${describeCauses(e)}` : String(e);

  for (const rule of RULES) {
    if (rule.when.test(text)) {
      return { title: rule.title, detail: rule.detail, raw, benign: rule.benign };
    }
  }

  // Unknown, so keep viem's first line — the summary, before the argument dump —
  // rather than inventing a reassurance we cannot stand behind.
  const first = (e instanceof Error ? e.message : String(e)).split('\n')[0]?.trim() ?? '';
  return {
    title: first && first.length <= 160 ? first : 'That transaction did not go through.',
    detail: 'The full error is below if you need to report it.',
    raw,
  };
}

/** viem nests the useful part (a revert's errorName) several causes down. */
function describeCauses(e: Error): string {
  const parts: string[] = [];
  let cur: unknown = (e as { cause?: unknown }).cause;
  for (let depth = 0; cur && depth < 8; depth++) {
    const c = cur as { name?: string; message?: string; errorName?: string; shortMessage?: string; cause?: unknown; data?: { errorName?: string } };
    parts.push(c.errorName ?? '', c.data?.errorName ?? '', c.shortMessage ?? '', c.name ?? '', c.message ?? '');
    cur = c.cause;
  }
  return parts.filter(Boolean).join(' ');
}
