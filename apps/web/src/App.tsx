import { parseDuelLink } from '@bullrun/sdk';
import { SdkProvider, useSdk } from './sdk';
import { WalletProvider } from './walletContext';
import { usePath } from './router';
import { Connect } from './screens/Connect';
import { Markets } from './screens/Markets';
import { Market } from './screens/Market';
import { CreateDuel } from './screens/CreateDuel';
import { Lobby } from './screens/Lobby';
import { LiveDuel } from './screens/LiveDuel';
import { Result } from './screens/Result';
import { AcceptDuel } from './screens/AcceptDuel';
import { ConsoleApp } from './console/ConsoleApp';



function Routes() {
  const [path, navigate] = usePath();
  const { cfg, duelsError } = useSdk();

  // S8 — /d/<chainId>/<escrow>/<duelId> (§5.3)
  const link = parseDuelLink(path);
  if (link) return <AcceptDuel link={link} navigate={navigate} />;

  const duelMatch = /^\/duel\/(\d+)$/.exec(path);
  if (duelMatch) {
    const id = BigInt(duelMatch[1]!);
    return <DuelScreens duelId={id} navigate={navigate} />;
  }

  const marketMatch = /^\/market\/(0x[0-9a-fA-F]+)$/.exec(path);
  if (marketMatch) return <Market marketId={marketMatch[1] as `0x${string}`} navigate={navigate} />;

  const createMatch = /^\/market\/(0x[0-9a-fA-F]+)\/duel$/.exec(path);
  if (createMatch) return <CreateDuel marketId={createMatch[1] as `0x${string}`} navigate={navigate} />;

  return (
    <>
      <Connect />
      {duelsError && <p className="warn">Duels unavailable: {duelsError}</p>}
      <hr />
      <Markets navigate={navigate} />
      <hr />
      <p className="muted">
        chain {cfg.chainId} · escrow {cfg.escrowAddress ?? `not deployed on ${cfg.network}`}
        {' · '}
        <a href="/console" onClick={(e) => { e.preventDefault(); navigate('/console'); }}>game console</a>
      </p>
    </>
  );
}

/** S5 → S6 → S7 are one route: the duel's own state decides which one renders.
 *  No ticker here — useDuel already polls duels(id) every 3s and pushes. */
function DuelScreens({ duelId, navigate }: { duelId: bigint; navigate: (to: string) => void }) {
  const { duels } = useSdk();
  if (!duels) return <p className="err">DUEL_ESCROW_ADDRESS is not set — deploy DuelEscrow first (M3).</p>;
  return (
    <>
      <Lobby duelId={duelId} navigate={navigate} />
      <LiveDuel duelId={duelId} />
      <Result duelId={duelId} />
    </>
  );
}

/** The active network is stated in the header, not assumed. A mainnet build must
 *  never be mistaken for the testnet one. */
function Banner() {
  const { cfg } = useSdk();
  return (
    <p className="muted">
      Peer-to-peer duels on DreamDEX Event Contracts. Unaudited.{' '}
      <strong className={cfg.network === 'mainnet' ? 'err' : 'ok'}>
        {cfg.network} · chain {cfg.chainId} · {cfg.collateralSymbol}
      </strong>
    </p>
  );
}

export function App() {
  return (
    <SdkProvider>
      <WalletProvider>
        <Shell />
      </WalletProvider>
    </SdkProvider>
  );
}

/** Inside the providers, so the console and the base front end share one wallet
 *  connection rather than each opening their own. */
function Shell() {
  const [path, navigate] = usePath();

  // The console owns the whole viewport and carries its own styling, so it
  // bypasses the base front end's chrome entirely. Simulated for now
  // (console/engine/market.ts); it will be fed from the SDK once binary market
  // discovery lands.
  if (path === '/console') return <ConsoleApp navigate={navigate} />;

  return (
    <main>
      <h1>BULLRUN</h1>
      <Banner />
      <hr />
      <Routes />
    </main>
  );
}
