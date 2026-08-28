import { useSdk } from '../../sdk';
import { useWallet } from '../../walletContext';

/** Step two. The wallet is the same one the base front end uses — connecting
 *  here connects everywhere. */
export function ConnectScreen({
  onBack, onDemo,
}: {
  onBack: () => void;
  onDemo: () => void;
}) {
  const { cfg } = useSdk();
  const { conn, connecting, error, wrongChain, doConnect, doSwitch } = useWallet();

  return (
    <div className="gate__body">
      <div className="wordmark">BULLRUN</div>

      <h1 className="gate__headline">Connect a wallet.</h1>
      <p className="gate__sub">
        {cfg.network === 'mainnet'
          ? `Somnia mainnet · chain ${cfg.chainId} · real ${cfg.collateralSymbol}.`
          : `Shannon testnet · chain ${cfg.chainId} · ${cfg.collateralSymbol} from the faucet.`}
      </p>

      {wrongChain ? (
        <>
          <p className="gate__warn">
            Wrong network — this build is {cfg.network}, chain {cfg.chainId}.
          </p>
          <button type="button" className="gate__start" onClick={doSwitch}>
            Switch to {cfg.chainName}
          </button>
        </>
      ) : (
        <button type="button" className="gate__start" disabled={connecting} onClick={doConnect}>
          {connecting ? 'Connecting…' : conn ? 'Continue' : 'Connect wallet'}
        </button>
      )}

      {error && <p className="gate__warn">{error}</p>}

      <button type="button" className="gate__demo" onClick={onDemo}>
        Skip — play the demo instead
      </button>

      {/* Said plainly rather than implied away: a wallet does not yet change
          what the console shows. Binary market discovery is not wired, so the
          prices here are simulated either way. */}
      <p className="gate__fine">
        Market data in the console is still simulated. Connecting does not change
        that yet — it is what the duel layer will run on.
      </p>

      <button type="button" className="gate__back" onClick={onBack}>Back</button>
    </div>
  );
}
