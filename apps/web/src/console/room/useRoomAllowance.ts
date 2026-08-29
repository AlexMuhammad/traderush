import { useCallback, useEffect, useState } from 'react';
import type { Account, WalletClient } from 'viem';
import { useSdk } from '../../sdk';
import { useWallet } from '../../walletContext';

/** The room escrow's allowance, and the approval the writes need.
 *
 *  open() and join() both pull the stake with transferFrom, so without an
 *  allowance they revert as ERC20InsufficientAllowance — a message that tells a
 *  first-time player nothing, and only after they commit. */
export function useRoomAllowance(needed: bigint) {
  const { rooms } = useSdk();
  const { conn } = useWallet();
  const [allowance, setAllowance] = useState<bigint | null>(null);
  const [approving, setApproving] = useState(false);
  const owner = conn?.account.address as `0x${string}` | undefined;

  const read = useCallback(() => {
    if (!rooms || !owner) return;
    rooms.allowance(owner).then(setAllowance).catch(() => setAllowance(null));
  }, [rooms, owner]);

  useEffect(() => { read(); }, [read]);

  /**
   * Make sure the escrow can move `needed`, approving only if it cannot.
   *
   * Callers await this immediately before the write it enables, rather than the
   * screen putting an Approve key in front of the real one. An approval is
   * plumbing: it is not a decision anybody makes, it has no meaning on its own,
   * and a first-time player reading "Approve tUSDC" where they expected "Open
   * the room" has to work out that the button they wanted has been replaced by
   * one they did not ask for.
   *
   * The allowance is read fresh from the chain here. React state can be one
   * approval behind — a stale `enough` either approves twice or skips an
   * approval that was never granted.
   */
  const ensure = useCallback(async (wallet: WalletClient, account: Account, amount: bigint) => {
    if (!rooms || !owner) return;
    const have = await rooms.allowance(owner);
    if (have >= amount) return;
    setApproving(true);
    try {
      // Approved far above any one stake, so this happens once per wallet and
      // never again — not once per room.
      await rooms.approve(wallet, account, 2n ** 255n);
      read();
    } finally { setApproving(false); }
  }, [rooms, owner, read]);

  return {
    allowance,
    /** null while unknown — do not block the UI on it. */
    enough: allowance === null ? null : allowance >= needed,
    /** True while the approval half of `ensure` is in flight, so a button can
     *  say which of its two steps is running. */
    approving,
    ensure,
  };
}
