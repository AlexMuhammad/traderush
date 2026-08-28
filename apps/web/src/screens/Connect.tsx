import { useEffect, useState } from 'react';
import { formatUnits } from 'viem';
import { CHAIN_ID } from '@bullrun/sdk';
import { useSdk } from '../sdk';
import { useWallet } from '../App';

/** S1 — Connect. Address, USDso balance, network guard, one-time approval. */
export function Connect() {
  const { market, duels } = useSdk();
  const { conn, connecting, error, wrongChain, doConnect, doSwitch } = useWallet();
  const [balance, setBalance] = useState<bigint | null>(null);
  const [decimals, setDecimals] = useState(18);
  const [allowance, setAllowance] = useState<bigint | null>(null);
  const [approving, setApproving] = useState(false);
  const [approveErr, setApproveErr] = useState<string | null>(null);

  useEffect(() => {
    if (!conn || wrongChain) { setBalance(null); return; }
    let alive = true;
    const load = async () => {
      try {
        // Gotcha §8.7 — reconcile against the WALLET, not the per-pool vault, which
        // is a payout fallback and reads 0 in normal operation.
        const [b, d] = await Promise.all([
          market.balance(conn.account.address),
          market.collateralDecimals(),
        ]);
        if (!alive) return;
        setBalance(b); setDecimals(d);
        if (duels) {
          const { collateral } = await market.addresses();
          const a = await duels.allowance(collateral, conn.account.address);
          if (alive) setAllowance(a);
        }
      } catch { /* the doctor script is where wiring problems get diagnosed */ }
    };
    void load();
    const t = setInterval(() => void load(), 10_000);
    return () => { alive = false; clearInterval(t); };
  }, [conn, wrongChain, market, duels]);

  const approve = async () => {
    if (!conn || !duels) return;
    setApproving(true); setApproveErr(null);
    try {
      const { collateral } = await market.addresses();
      // A large one-time approval so open/accept never needs a second popup (M4).
      await duels.approve(conn.wallet, conn.account, collateral, 2n ** 255n);
      setAllowance(2n ** 255n);
    } catch (e) {
      setApproveErr(e instanceof Error ? e.message : String(e));
    } finally { setApproving(false); }
  };

  if (!conn) {
    return (
      <section className="panel">
        <h2>Connect</h2>
        <button onClick={doConnect} disabled={connecting}>
          {connecting ? 'connecting…' : 'Connect wallet'}
        </button>
        {error && <p className="err">{error}</p>}
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>Connected</h2>
      <dl>
        <dt>address</dt><dd><code>{conn.account.address}</code></dd>
        <dt>chain</dt>
        <dd>
          {conn.chainId}{' '}
          {wrongChain
            ? <span className="err">— wrong network, BULLRUN is chain {CHAIN_ID} only</span>
            : <span className="ok">— Shannon</span>}
        </dd>
        <dt>balance</dt>
        <dd>{balance === null ? <span className="muted">…</span> : `${formatUnits(balance, decimals)} USDso`}</dd>
        <dt>escrow approval</dt>
        <dd>
          {allowance === null
            ? <span className="muted">…</span>
            : allowance > 0n
              ? <span className="ok">approved</span>
              : <span className="warn">not approved</span>}
        </dd>
      </dl>
      <div className="row">
        {wrongChain && <button onClick={doSwitch}>Switch to Shannon</button>}
        {!wrongChain && duels && allowance !== null && allowance === 0n && (
          <button onClick={() => void approve()} disabled={approving}>
            {approving ? 'approving…' : 'Approve USDso (one time)'}
          </button>
        )}
      </div>
      {approveErr && <p className="err">{approveErr}</p>}
    </section>
  );
}
