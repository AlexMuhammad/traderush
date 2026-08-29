import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { PrivyProvider, usePrivy, useWallets } from '@privy-io/react-auth';
import { createWalletClient, custom, type Account, type WalletClient } from 'viem';
import { useSdk } from './sdk';

/**
 * The wallet connection, shared by every screen.
 *
 * Privy is the front door: email, socials or an injected wallet, and an embedded
 * wallet for anyone without one. What comes out the other side is a plain viem
 * WalletClient, so nothing downstream knows or cares how the person got here.
 *
 * Only Privy's PUBLIC app id is used. The app secret is a server credential and
 * this product has no server (§12) — it must never reach the browser.
 */
export interface Connection {
  wallet: WalletClient;
  account: Account;
  chainId: number;
}

export interface WalletCtx {
  conn: Connection | null;
  connecting: boolean;
  error: string | null;
  /** Connected, but pointed at a different chain than this build. */
  wrongChain: boolean;
  /** Privy has finished restoring any existing session. Until this is true we
   *  do not yet know whether someone is signed in, and showing them a title
   *  card only to snatch it away is worse than showing nothing. */
  ready: boolean;
  doConnect: () => void;
  doSwitch: () => void;
  doDisconnect: () => Promise<void>;
  /** True while the sign-out is in flight. */
  signingOut: boolean;
  /** How the person is signed in, for the menu to show. */
  label: string | null;
}

const WalletContext = createContext<WalletCtx | null>(null);

export function useWallet(): WalletCtx {
  const c = useContext(WalletContext);
  if (!c) throw new Error('useWallet outside WalletProvider');
  return c;
}

/** Picks an implementation once, from config. The choice cannot change while
 *  the app runs, so there is no hook-order hazard in branching here. */
export function WalletProvider({ children }: { children: ReactNode }) {
  const { cfg } = useSdk();

  if (!cfg.privyAppId) return <Unconfigured>{children}</Unconfigured>;

  return (
    <PrivyProvider
      appId={cfg.privyAppId}
      config={{
        defaultChain: cfg.chain,
        // Only the chain this build targets. Offering others would let someone
        // connect somewhere the escrow does not exist.
        supportedChains: [cfg.chain],
        // Anyone arriving with an email and no wallet still gets one.
        embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' } },
        appearance: {
          theme: 'dark',
          accentColor: '#FFC857',
          walletChainType: 'ethereum-only',
        },
      }}
    >
      <PrivyWallet>{children}</PrivyWallet>
    </PrivyProvider>
  );
}

function PrivyWallet({ children }: { children: ReactNode }) {
  const { cfg } = useSdk();
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();

  const [conn, setConn] = useState<Connection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const active = wallets[0];
  const address = active?.address as `0x${string}` | undefined;
  const walletChain = active?.chainId;

  useEffect(() => {
    // `authenticated` is the gate, not just the wallet list. Privy clears the
    // session before the list empties, and without this the connection is
    // rebuilt in the gap — a sign-out that does not stick, and a refresh that
    // walks straight back in.
    if (!authenticated || !active || !address) { setConn(null); return; }
    let alive = true;
    active.getEthereumProvider()
      .then((provider) => {
        if (!alive) return;
        setConn({
          wallet: createWalletClient({ chain: cfg.chain, transport: custom(provider), account: address }),
          account: { address, type: 'json-rpc' } as Account,
          // Privy reports CAIP-2 ("eip155:50312"); everything else wants a number.
          chainId: Number(String(walletChain ?? '').split(':')[1] ?? 0),
        });
        setError(null);
      })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [authenticated, active, address, walletChain, cfg.chain]);

  const doConnect = () => {
    if (!ready) return;
    setError(null);
    if (authenticated) return;      // already in; the wallet effect will catch up
    setConnecting(true);
    try { login(); } finally { setConnecting(false); }
  };

  const doSwitch = () => {
    if (!active) return;
    setError(null);
    active.switchChain(cfg.chainId)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };

  const [signingOut, setSigningOut] = useState(false);

  /** A real sign-out: Privy's session is cleared, so a refresh does not walk
   *  back in. Awaited rather than fired and forgotten — the UI should not say
   *  "signed out" before it is true. */
  const doDisconnect = async () => {
    setSigningOut(true);
    setConn(null);
    setError(null);
    try { await logout(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSigningOut(false); }
  };

  const wrongChain = Boolean(conn && conn.chainId !== cfg.chainId);
  const label = conn
    ? (user?.email?.address ?? user?.google?.email ?? active?.walletClientType ?? 'wallet')
    : null;

  return (
    <WalletContext.Provider
      value={{
        conn, connecting: connecting || !ready, error, wrongChain,
        // Not just Privy's own ready flag: a restored session still has to
        // resolve its provider into a client, and until it does `conn` is null
        // for a reason that is not "signed out".
        ready: ready && (!authenticated || conn !== null || wallets.length === 0),
        doConnect, doSwitch, doDisconnect, signingOut, label,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

/** No app id configured. Everything still runs — the console's demo needs no
 *  wallet — but anything that would sign says why instead of failing opaquely. */
function Unconfigured({ children }: { children: ReactNode }) {
  const [error, setError] = useState<string | null>(null);
  const complain = () => setError('VITE_PRIVY_APP_ID is not set — wallet connection is unavailable.');
  return (
    <WalletContext.Provider
      value={{
        conn: null, connecting: false, error, wrongChain: false, ready: true,
        doConnect: complain, doSwitch: complain,
        doDisconnect: async () => {}, signingOut: false, label: null,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}
