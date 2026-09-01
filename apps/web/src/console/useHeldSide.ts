import { useCallback, useEffect, useState } from 'react';
import { binarySettlementAbi, erc6909Abi } from '@traderush/sdk';
import { useSdk } from '../sdk';
import { useWallet } from '../walletContext';

/**
 * Which side of a window this wallet is actually holding, read from the chain.
 *
 * The console used to keep this as a flag set at the moment of buying, and
 * anything that rebuilt the scene — a window rolling, a dial being tuned, a
 * reload — wiped it. The contracts were still in the wallet; the machine had
 * simply forgotten, and a position that vanishes looks exactly like one that was
 * cancelled.
 *
 * So it is derived, not remembered. Outcome tokens are the position: holding a
 * hundred UP is a hundred collateral if UP takes the window, and no amount of
 * re-rendering changes that.
 */
export function useHeldSide(marketId: string | undefined) {
  const { cfg, market } = useSdk();
  const { conn } = useWallet();
  const owner = conn?.account.address as `0x${string}` | undefined;

  const [held, setHeld] = useState<{ up: bigint; down: bigint } | null>(null);
  const [tick, setTick] = useState(0);

  /** Ask again — after a buy, without waiting for the poll. */
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!owner || !marketId) { setHeld(null); return; }
    // A different window is a different position. Forget the last one before
    // the new read lands, or the old side rides through the roll and the scene
    // hunts a contract that settled a minute ago.
    setHeld(null);
    let alive = true;

    const read = async () => {
      try {
        const ref = await market.ref(marketId);
        if (!ref) return;
        const token = await market.publicClient.readContract({
          address: cfg.addresses.binarySettlement,
          abi: binarySettlementAbi,
          functionName: 'outcomeToken',
        }) as `0x${string}`;
        const balance = (id: bigint) => market.publicClient.readContract({
          address: token, abi: erc6909Abi, functionName: 'balanceOf', args: [owner, id],
        }) as Promise<bigint>;
        const [up, down] = await Promise.all([balance(ref.upId), balance(ref.downId)]);
        if (alive) setHeld({ up, down });
      } catch {
        // A read that fails is not a position that vanished. Keep the last
        // answer rather than reporting the wallet empty.
      }
    };

    void read();
    const t = setInterval(read, 5_000);
    return () => { alive = false; clearInterval(t); };
  }, [owner, marketId, market, cfg.addresses.binarySettlement, tick]);

  // Both legs at once is possible and means no exposure either way; the bigger
  // one is what the scene should answer to.
  const side: 'up' | 'down' | null = !held || (held.up === 0n && held.down === 0n) ? null
    : held.up >= held.down ? 'up' : 'down';

  return { side, held, refresh };
}
