import { useEffect, useState } from 'react';
import { useSdk } from '../sdk';

/**
 * Top of book for one window, read from the pool.
 *
 * Prices shown in a list can come from the indexer; prices a person is about to
 * act on cannot. The two disagreed by a full point on a live market, which is
 * enough to offer a key that cannot fill and to promise a return nobody was
 * offering.
 *
 * Polled rather than watched: this is one eth_call every few seconds against a
 * book that turns over in the same order of time, and a subscription that has
 * to warm up reads empty exactly when someone first arrives.
 */
export function useBookTop(marketId: string | undefined) {
  const { market } = useSdk();
  const [top, setTop] = useState<{ bid: bigint | null; ask: bigint | null } | null>(null);

  useEffect(() => {
    if (!marketId) { setTop(null); return; }
    let alive = true;
    // A different window is a different book. Forget the last one rather than
    // quoting it for a market it never belonged to.
    setTop(null);

    const read = () => market.bookTop(marketId)
      .then((t) => { if (alive) setTop(t); })
      .catch(() => { /* keep the last answer; a failed read is not an empty book */ });

    void read();
    const t = setInterval(read, 4_000);
    return () => { alive = false; clearInterval(t); };
  }, [marketId, market]);

  return top;
}
