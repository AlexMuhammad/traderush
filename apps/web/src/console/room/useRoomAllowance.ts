import { useCallback, useEffect, useState } from 'react';
import type { Account, WalletClient } from 'viem';
import { useSdk } from '../../sdk';
import { useWallet } from '../../walletContext';

/** The room escrow's allowance, and a one-press approve.
 *
 *  open() and join() both pull the stake with transferFrom, so without an
 *  allowance they revert as ERC20InsufficientAllowance — a message that tells a
 *  first-time player nothing, and only after they commit. */
export function useRoomAllowance(needed: bigint) {
  const { rooms } = useSdk();
  const { conn } = useWallet();
  const [allowance, setAllowance] = useState<bigint | null>(null);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const owner = conn?.account.address as `0x${string}` | undefined;

  const read = useCallback(() => {
    if (!rooms || !owner) return;
    rooms.allowance(owner).then(setAllowance).catch(() => setAllowance(null));
  }, [rooms, owner]);

  useEffect(() => { read(); }, [read]);

  const approve = async (wallet: WalletClient, account: Account) => {
    if (!rooms) return;
    setApproving(true); setError(null);
    try {
      // Approved once, far above any one stake, so joining a room is one tap.
      await rooms.approve(wallet, account, 2n ** 255n);
      read();
    } catch (e) {
      setError(e);
    } finally { setApproving(false); }
  };

  return {
    allowance,
    /** null while unknown — do not block the UI on it. */
    enough: allowance === null ? null : allowance >= needed,
    approving,
    error,
    approve,
  };
}
