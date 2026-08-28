import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useSdk } from './sdk';
import { connect, switchNetwork, type Connection } from './wallet';

/** The wallet connection, shared by the base front end and the game console.
 *
 *  Its own module rather than a corner of App.tsx: App imports the console,
 *  the console's connect screen needs this, and that closes an import cycle
 *  back onto App. Cycles resolve for hoisted declarations, which is exactly
 *  the kind of thing that works until someone converts one to a const.
 */
export interface WalletCtx {
  conn: Connection | null;
  connecting: boolean;
  error: string | null;
  /** Connected, but the wallet is pointed at a different chain than this build. */
  wrongChain: boolean;
  doConnect: () => void;
  doSwitch: () => void;
}

const WalletContext = createContext<WalletCtx | null>(null);

export function useWallet(): WalletCtx {
  const c = useContext(WalletContext);
  if (!c) throw new Error('useWallet outside WalletProvider');
  return c;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const { cfg } = useSdk();
  const [conn, setConn] = useState<Connection | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doConnect = () => {
    setConnecting(true);
    setError(null);
    connect(cfg.chain)
      .then(setConn)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setConnecting(false));
  };

  const doSwitch = () => {
    switchNetwork(cfg.chain)
      .then(() => connect(cfg.chain).then(setConn))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };

  // Wallets change account and chain out from under the page; re-read rather
  // than signing against a stale connection.
  useEffect(() => {
    const p = window.ethereum;
    if (!p) return;
    const refresh = () => { if (conn) connect(cfg.chain).then(setConn).catch(() => setConn(null)); };
    p.on?.('accountsChanged', refresh);
    p.on?.('chainChanged', refresh);
    return () => {
      p.removeListener?.('accountsChanged', refresh);
      p.removeListener?.('chainChanged', refresh);
    };
  }, [conn, cfg.chain]);

  const wrongChain = Boolean(conn && conn.chainId !== cfg.chainId);

  return (
    <WalletContext.Provider value={{ conn, connecting, error, wrongChain, doConnect, doSwitch }}>
      {children}
    </WalletContext.Provider>
  );
}
