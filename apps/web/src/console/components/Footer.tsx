import { formatUnits } from 'viem';
import type { Engine } from '../engine/engine';
import type { ConsoleSnapshot } from '../engine/types';
import { useBalance, useSdk } from '../../sdk';
import { useWallet } from '../../walletContext';

/** What you are looking at, and what you have.
 *
 *  The speed control is DEMO ONLY. Live, `t` is wall-clock against the market's
 *  own window — the chain does not care how fast we are watching — so offering
 *  "×20" beside "live prices" would be a straight contradiction.
 *
 *  The balance is the real one. There used to be a paper score here, which made
 *  the machine carry two currencies — and the one on the plate was the one that
 *  did not exist.
 */
export function Footer({ engine, s }: { engine: Engine; s: ConsoleSnapshot }) {
  const { cfg } = useSdk();
  const { conn } = useWallet();
  const balance = useBalance(conn?.account.address as `0x${string}` | undefined);

  return (
    <div className="foot eng">
      {s.live ? (
        <span>Live · {cfg.network} · chain {cfg.chainId}</span>
      ) : (
        <span style={{ cursor: 'pointer' }} onPointerDown={() => { engine.wake(); engine.cycleSpeed(); }}>
          Demo ×{s.speed} · {s.speed === 1 ? 'real time' : 'tap to slow'}
        </span>
      )}
      <span>
        {balance === null ? '—' : formatUnits(balance, cfg.decimals)} {cfg.collateralSymbol}
      </span>
    </div>
  );
}
