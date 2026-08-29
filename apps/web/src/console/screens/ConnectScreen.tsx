import { useSdk } from '../../sdk';
import { useWallet } from '../../walletContext';

/** Step two. Privy is the front door — email, a social account, or an injected
 *  wallet; anyone without one gets an embedded wallet. What the app receives is
 *  a plain viem client either way. */
export function ConnectScreen({ onBack }: { onBack: () => void }) {
  const { cfg } = useSdk();
  const { conn, connecting, error, wrongChain, doConnect, doSwitch } = useWallet();

  return (
    <div className="gate__body">
      <div className="wordmark">BULLRUN</div>

      <h1 className="gate__headline">Sign in.</h1>
      <p className="gate__sub">
        {cfg.network === 'mainnet'
          ? `Somnia mainnet · chain ${cfg.chainId} · real ${cfg.collateralSymbol}.`
          : `Shannon testnet · chain ${cfg.chainId} · ${cfg.collateralSymbol} from the faucet.`}
        {' '}Email, a social account or your own wallet — no extension required.
      </p>

      {wrongChain ? (
        <>
          <p className="gate__warn">
            Your wallet is on another network. This build is {cfg.network}, chain {cfg.chainId}.
          </p>
          <button type="button" className="gate__start" onClick={doSwitch}>
            Switch to {cfg.chainName}
          </button>
        </>
      ) : (
        <button type="button" className="gate__start" disabled={connecting} onClick={doConnect}>
          {connecting ? 'One moment…' : conn ? 'Continue' : 'Sign in'}
        </button>
      )}

      {error && <p className="gate__warn">{error}</p>}

      {/* Said plainly rather than implied away: signing in does not yet change
          what the console's keys do. The prices are real; the stakes are points
          until book orders are wired. Duels are the real thing. */}
      <p className="gate__fine">
        Prices and windows here are live markets. The console's own keys stake
        points; a duel stakes {cfg.collateralSymbol}, and that is what the wallet
        is for.
      </p>

      <button type="button" className="gate__back" onClick={onBack}>Back</button>
    </div>
  );
}
