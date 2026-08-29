import { FAUCET_UNITS, faucetAbi } from './faucetAbi';
import { formatUnits } from 'viem';
import { useBalance, useSdk } from '../../sdk';
import { useWallet } from '../../walletContext';
import { Key } from '../components/Key';
import { Fault, Readout } from '../components/Readout';
import { useState } from 'react';

/**
 * Put money in.
 *
 * There is no deposit transaction to send. A wallet is funded by somebody
 * sending to it, which means the whole screen is one address and the ways of
 * getting it out of here — plus, on testnet, the faucet that skips the errand
 * entirely. Saying that outright is the point: a Deposit button that opens a
 * form implies the app can pull funds, and it cannot.
 */
export function DepositPanel({ onBack }: { onBack: () => void }) {
  const { cfg, market } = useSdk();
  const { conn } = useWallet();
  const balance = useBalance(conn?.account.address as `0x${string}` | undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [hash, setHash] = useState<string | null>(null);

  if (!conn) {
    return <Readout title="Deposit"><p className="note err">Sign in first.</p></Readout>;
  }
  const addr = conn.account.address;

  // The testnet token mints to whoever asks, so there the faucet IS the deposit
  // — same call the menu row makes, surfaced where someone looking to add funds
  // will actually look for it.
  const mint = async () => {
    if (!cfg.faucet) return;
    setBusy(true); setError(null);
    try {
      const tx = await conn.wallet.writeContract({
        chain: cfg.chain, account: conn.account,
        address: cfg.addresses.collateral, abi: faucetAbi,
        functionName: 'faucet', args: [FAUCET_UNITS * 10n ** BigInt(cfg.decimals)],
      });
      await market.publicClient.waitForTransactionReceipt({ hash: tx });
      setHash(tx);
    } catch (e) { setError(e); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div className="q">
        <span className="exp">{cfg.chainName}</span>
        Send <b>{cfg.collateralSymbol}</b> to this address on <b>{cfg.chainName}</b>.
        Nothing else reaches it.
      </div>

      <div className="order">
        <div className="calc">
          <span>balance</span>
          <span className="lamp">
            {balance === null ? '…' : `${formatUnits(balance, cfg.decimals)} ${cfg.collateralSymbol}`}
          </span>
        </div>
      </div>

      <div className="order">
        <label className="field">
          <span>your address</span>
          <input readOnly value={addr} onFocus={(e) => e.currentTarget.select()} />
        </label>
        <div className="linkline">
          <code title={addr}>{addr}</code>
          <button onClick={() => void navigator.clipboard.writeText(addr)}>copy</button>
        </div>
      </div>

      <p className="hint hint--warn">
        This address only holds funds on {cfg.chainName}. Tokens sent from another
        chain, or a different token on this one, do not arrive — they are gone.
      </p>

      <div className="calls calls--act">
        <Key onPress={onBack}><span className="nm">back</span></Key>
        {cfg.faucet ? (
          <Key lit={!busy} disabled={busy} onPress={() => void mint()}>
            <span className="nm">{busy ? 'minting…' : `get ${FAUCET_UNITS.toLocaleString('en-US')} ${cfg.collateralSymbol}`}</span>
          </Key>
        ) : (
          <Key disabled><span className="nm">send from a wallet</span></Key>
        )}
      </div>

      {hash && <p className="hint">Minted. The balance above refreshes on its own.</p>}
      {error ? <Fault error={error} /> : null}
    </>
  );
}
