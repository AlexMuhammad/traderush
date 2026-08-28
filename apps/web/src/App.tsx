import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { CHAIN_ID, parseDuelLink } from '@bullrun/sdk';
import { SdkProvider, useSdk } from './sdk';
import { usePath } from './router';
import { connect, switchToShannon, type Connection } from './wallet';
import { Connect } from './screens/Connect';
import { Markets } from './screens/Markets';
import { Market } from './screens/Market';
import { CreateDuel } from './screens/CreateDuel';
import { Lobby } from './screens/Lobby';
import { LiveDuel } from './screens/LiveDuel';
import { Result } from './screens/Result';
import { AcceptDuel } from './screens/AcceptDuel';

interface WalletCtx {
  conn: Connection | null;
  connecting: boolean;
  error: string | null;
  wrongChain: boolean;
  doConnect: () => void;
  doSwitch: () => void;
}
const WalletContext = createContext<WalletCtx | null>(null);
export function useWallet(): WalletCtx {
  const c = useContext(WalletContext);
  if (!c) throw new Error('useWallet outside provider');
  return c;
}

function WalletProvider({ children }: { children: ReactNode }) {
  const [conn, setConn] = useState<Connection | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doConnect = () => {
    setConnecting(true); setError(null);
    connect()
      .then(setConn)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setConnecting(false));
  };

  const doSwitch = () => {
    switchToShannon()
      .then(() => connect().then(setConn))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };

  // Wallets change account and chain out from under the page; re-read rather than
  // signing against a stale connection.
  useEffect(() => {
    const p = window.ethereum;
    if (!p) return;
    const refresh = () => { if (conn) connect().then(setConn).catch(() => setConn(null)); };
    p.on?.('accountsChanged', refresh);
    p.on?.('chainChanged', refresh);
    return () => {
      p.removeListener?.('accountsChanged', refresh);
      p.removeListener?.('chainChanged', refresh);
    };
  }, [conn]);

  const wrongChain = Boolean(conn && conn.chainId !== CHAIN_ID);
  return (
    <WalletContext.Provider value={{ conn, connecting, error, wrongChain, doConnect, doSwitch }}>
      {children}
    </WalletContext.Provider>
  );
}

function Routes() {
  const [path, navigate] = usePath();
  const { cfg, duelsError } = useSdk();

  // S8 — /d/<chainId>/<escrow>/<duelId> (§5.3)
  const link = parseDuelLink(path);
  if (link) return <AcceptDuel link={link} navigate={navigate} />;

  const duelMatch = /^\/duel\/(\d+)$/.exec(path);
  if (duelMatch) {
    const id = BigInt(duelMatch[1]!);
    return <DuelRoute duelId={id} navigate={navigate} />;
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
        chain {cfg.chainId} · escrow {cfg.escrowAddress ?? 'not deployed'} · unaudited, testnet only
      </p>
    </>
  );
}

/** S5 → S6 → S7 are one route: the duel's own state decides which one renders. */
function DuelRoute({ duelId, navigate }: { duelId: bigint; navigate: (to: string) => void }) {
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 3000); return () => clearInterval(t); }, []);
  return <DuelScreens duelId={duelId} navigate={navigate} />;
}

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

export function App() {
  return (
    <SdkProvider>
      <WalletProvider>
        <main>
          <h1>BULLRUN</h1>
          <p className="muted">
            Peer-to-peer duels on DreamDEX Event Contracts. Shannon testnet only. Unaudited.
          </p>
          <hr />
          <Routes />
        </main>
      </WalletProvider>
    </SdkProvider>
  );
}
