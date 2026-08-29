import { useSdk } from '../../sdk';
import { useWallet } from '../../walletContext';

/**
 * The gate. One card, one button.
 *
 * Start opens Privy directly — a separate "now connect" step said nothing the
 * person had not already agreed to by pressing Start. The card stays put while
 * the modal is up and turns into a network prompt if the wallet lands on the
 * wrong chain, so there is only ever one thing to press.
 */
export function StartScreen() {
  const { cfg } = useSdk();
  const { connecting, error, wrongChain, doConnect, doSwitch } = useWallet();

  return (
    <div className="gate__body">
      {/* <div className="wordmark">BULLRUN</div> */}

      <h1 className="gate__headline">
        {wrongChain ? 'Wrong network.' : 'Stay on the right side.'}
      </h1>

      <p className="gate__sub">
        {wrongChain
          ? `Your wallet is somewhere else. This build is ${cfg.network}, chain ${cfg.chainId}.`
          : 'Fifteen minutes and one line. The animals never cross it — you are the only thing that can.'}
      </p>

      {wrongChain ? (
        <button type="button" className="gate__start" onClick={doSwitch}>
          Switch to {cfg.chainName}
        </button>
      ) : (
        <button type="button" className="gate__start" disabled={connecting} onClick={doConnect}>
          {connecting ? 'One moment…' : 'Start'}
        </button>
      )}

      {error && <p className="gate__warn">{error}</p>}

      <p className="gate__fine">
        {cfg.network === 'mainnet'
          ? `Somnia mainnet · chain ${cfg.chainId} · real ${cfg.collateralSymbol}.`
          : `Shannon testnet · chain ${cfg.chainId} · ${cfg.collateralSymbol} from the faucet.`}
        {' '}Email, a social account or your own wallet — no extension required.
        <br />
      </p>
    </div>
  );
}
