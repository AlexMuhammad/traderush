import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { PrivyProvider, usePrivy, useWallets } from '@privy-io/react-auth';
import { createWalletClient, custom, http, type Account, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
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

  // A local signer, for capture and for driving the console without a human at
  // the login prompt. DEV builds only and never bundled otherwise: `import.meta
  // .env.DEV` is a compile-time constant, so the branch and the key both drop
  // out of a production build. The key is a throwaway testnet one — treat
  // anything set here as published, because in a dev bundle it is.
  const keys = import.meta.env.DEV
    ? {
        b: import.meta.env.VITE_DEMO_KEY as string | undefined,
        a: import.meta.env.VITE_DEMO_KEY_A as string | undefined,
      }
    : {};

  /**
   * `?wallet=` picks the signer for THIS TAB.
   *
   *   (nothing)  the local signer, VITE_DEMO_KEY
   *   a          the second local signer, VITE_DEMO_KEY_A
   *   privy      no local signer at all — the real front door
   *
   * Per-tab rather than per-dev-server, because the two things a single key
   * makes impossible are both shots the film needs. `privy` is the connect
   * flow, which demo mode is precisely what removes. And `a` is the other half
   * of a DUEL: two sides, two signers, one escrow, filmed side by side. Two dev
   * servers would work and would also mean two builds, two ports and two
   * chances for them to drift apart mid-take.
   */
  const want = typeof window === 'undefined'
    ? null
    : new URLSearchParams(window.location.search).get('wallet');

  const key = want === 'privy' ? undefined : want === 'a' ? keys.a : keys.b;

  if (key && /^0x[0-9a-fA-F]{64}$/.test(key.trim())) {
    // Keyed so React rebuilds the whole subtree when the signer changes, rather
    // than leaving a screen holding the other player's balance.
    return <DemoWallet key={key} privateKey={key.trim() as `0x${string}`}>{children}</DemoWallet>;
  }

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

/**
 * A local signer held in the page — capture mode.
 *
 * Privy is the front door for people; this is the door for a script. It signs
 * with a key from the environment and talks straight to the RPC, so every write
 * below it is the same write a person makes: real transactions, real markets,
 * the same SDK. Nothing downstream can tell the difference, which is the point —
 * footage of a bypass that behaves differently is footage of a different product.
 *
 * It is connected from the first frame. There is no login to wait for, so
 * `ready` is true immediately and `doConnect` has nothing to do.
 */
function DemoWallet({ privateKey, children }: { privateKey: `0x${string}`; children: ReactNode }) {
  const { cfg } = useSdk();

  const conn = useMemo<Connection>(() => {
    const account = privateKeyToAccount(privateKey);
    return {
      wallet: createWalletClient({ chain: cfg.chain, transport: http(cfg.rpcUrl), account }),
      account,
      chainId: cfg.chainId,
    };
  }, [privateKey, cfg.chain, cfg.chainId, cfg.rpcUrl]);

  // Signing out of a key that is compiled in would only put up a title card the
  // next reload walks straight back past. It is inert on purpose.
  return (
    <WalletContext.Provider
      value={{
        conn, connecting: false, error: null, wrongChain: false, ready: true,
        doConnect: () => {}, doSwitch: () => {},
        doDisconnect: async () => {}, signingOut: false,
        label: `demo ${conn.account.address.slice(0, 6)}…`,
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
