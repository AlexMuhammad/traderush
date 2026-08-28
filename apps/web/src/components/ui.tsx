import { useState, type ReactNode } from 'react';
import { formatUnits, parseUnits } from 'viem';
import type { MarketStatus, MarketState } from '@bullrun/sdk';
import { txUrl, oracleUrl, UI_FREEZE_SEC } from '@bullrun/sdk';
import { useSdk, useNow } from '../sdk';

export function StatusBadge({ status }: { status: MarketStatus }) {
  return <span className={`badge badge--${status}`}>{status}</span>;
}

export function Countdown({ to, label = 'ends in' }: { to: number; label?: string }) {
  const now = useNow();
  if (!to) return <span className="muted">—</span>;
  const left = to - now;
  if (left <= 0) return <span className="muted">{label} —</span>;
  const m = Math.floor(left / 60), s = left % 60;
  return <span>{label} {m > 0 ? `${m}m ` : ''}{s}s</span>;
}

export function TxLink({ hash, children }: { hash: string; children?: ReactNode }) {
  const { cfg } = useSdk();
  return (
    <a href={txUrl(cfg, hash)} target="_blank" rel="noreferrer">
      {children ?? `${hash.slice(0, 10)}…${hash.slice(-8)}`}
    </a>
  );
}

export function OracleLink({ questionId }: { questionId: string | null }) {
  const { cfg } = useSdk();
  if (!questionId) return <span className="muted">no oracle question id on this market</span>;
  return <a href={oracleUrl(cfg, questionId)} target="_blank" rel="noreferrer">oracle question</a>;
}

/** §6.2 — every write shows a pending state and the resulting tx hash. */
export function TxState({ pending, error, hash }: { pending: boolean; error: string | null; hash: string | null }) {
  if (pending) return <p className="warn">pending — waiting for the transaction to be mined…</p>;
  if (error) return <p className="err">{error}</p>;
  if (hash) return <p className="ok">confirmed — <TxLink hash={hash} /></p>;
  return null;
}

/** The ONLY place a collateral amount is formatted. Decimals come from the active
 *  network — 6 on testnet (tUSDC), 18 on mainnet (USDso) — so a hardcoded 18 would
 *  render every testnet balance a million times too small. */
export function Amount({ value }: { value: bigint }) {
  const { cfg } = useSdk();
  return <span>{formatUnits(value, cfg.decimals)} {cfg.collateralSymbol}</span>;
}

/** Same formatting, for places that need the bare string. */
export function useMoney() {
  const { cfg } = useSdk();
  return {
    decimals: cfg.decimals,
    symbol: cfg.collateralSymbol,
    format: (v: bigint) => `${formatUnits(v, cfg.decimals)} ${cfg.collateralSymbol}`,
    plain: (v: bigint) => formatUnits(v, cfg.decimals),
    parse: (v: string) => parseUnits(v || '0', cfg.decimals),
  };
}

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => {
      void navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
    }}>
      {copied ? 'copied' : 'copy'}
    </button>
  );
}

/** §5.1 — on a socket drop the readout is DIMMED, never silently frozen. */
export function StaleWrapper({ state, children }: { state: MarketState | null; children: ReactNode }) {
  const stale = Boolean(state?.error);
  return (
    <div className={stale ? 'stale' : undefined}>
      {stale && <p className="warn">feed {state?.error} — the numbers below may be out of date</p>}
      {children}
    </div>
  );
}

/** §6.2 — disable trade/accept a FEW SECONDS BEFORE expiry, not at zero (§8.11 too). */
export function useFrozen(expiryTime: number): boolean {
  const now = useNow();
  if (!expiryTime) return false;
  return now >= expiryTime - UI_FREEZE_SEC;
}
