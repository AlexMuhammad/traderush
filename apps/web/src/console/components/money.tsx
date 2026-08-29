import { useMemo } from 'react';
import { formatUnits, parseUnits } from 'viem';
import { useSdk } from '../../sdk';

/** The only place a collateral amount is formatted or parsed.
 *
 *  Decimals come from the ACTIVE network — 6 on testnet (tUSDC), 18 on mainnet
 *  (USDso). A hardcoded 18 renders every testnet balance a million times too
 *  small, which is exactly what the first cut of this app did.
 */
export function useMoney() {
  const { cfg } = useSdk();
  // Memoised, and that is not a micro-optimisation: this used to hand back a
  // fresh object on every render, so any effect listing `money` in its deps
  // re-ran on every render. The console publishes a snapshot every frame, so
  // such an effect restarted several times a second — cancelling its own fetch
  // before it could ever finish. ScreenHistory sat on "reading…" forever.
  return useMemo(() => ({
    decimals: cfg.decimals,
    symbol: cfg.collateralSymbol,
    /** "12.50 tUSDC" */
    format: (v: bigint) => `${formatUnits(v, cfg.decimals)} ${cfg.collateralSymbol}`,
    /** "12.50" */
    plain: (v: bigint) => formatUnits(v, cfg.decimals),
    parse: (v: string) => parseUnits(v || '0', cfg.decimals),
  }), [cfg.decimals, cfg.collateralSymbol]);
}
