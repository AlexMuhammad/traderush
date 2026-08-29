import { useEffect, useMemo, useRef, useState } from 'react';
import { parseDuelLink, parseRoomLink } from '@bullrun/sdk';
import { formatUnits } from 'viem';
import { useWallet } from '../walletContext';
import { useBalance, useSdk } from '../sdk';
import { usePath } from '../router';
import { Engine } from './engine/engine';
import { LiveFeed } from './engine/feed';
import type { ConsoleSnapshot } from './engine/types';
import { Panel } from './components/Panel';
import { Marquee } from './components/Marquee';
import { Footer } from './components/Footer';
import { GameFace } from './GameFace';
import { NavPad } from './components/NavPad';
import { ScreenList, type ScreenItem } from './components/ScreenList';
import { ScreenMarkets } from './components/ScreenMarkets';
import { ScreenDuels } from './components/ScreenDuels';
import { ScreenPositions } from './components/ScreenPositions';
import { ScreenHistory } from './components/ScreenHistory';
import { ScreenRooms } from './components/ScreenRooms';
import { CreateRoomPanel } from './room/CreateRoomPanel';
import { RoomPanel } from './room/RoomPanel';
import { CreateDuelPanel } from './duel/CreateDuelPanel';
import { DuelPanel } from './duel/DuelPanel';
import { AcceptPanel } from './duel/AcceptPanel';
import { StartScreen } from './screens/StartScreen';
import './console.css';

/** What the CRT shows. `create` is the market list in pick-for-duel mode. */
type Screen =
  | 'game' | 'menu' | 'markets' | 'create'
  | 'createRoom' | 'rooms' | 'duels' | 'positions' | 'history';

/** TestUSDC's own faucet. Not part of the ERC-20 standard, hence a local ABI. */
const faucetAbi = [
  { type: 'function', name: 'faucet', stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }], outputs: [] },
] as const;

/**
 * The console is the whole application.
 *
 * There is one plate, one header, one footer and one menu; only the middle
 * changes. Markets, creating a duel, the lobby, the live duel and the payout are
 * all panels cut into the same machine rather than a second, plainer front end
 * living alongside it.
 *
 * The engine lives here rather than in the game face so the shell can read its
 * snapshot even while a duel screen is showing.
 */
export function ConsoleApp() {
  const [path, navigate] = usePath();
  /** What the CRT is showing. The menu key opens `menu`; the game is default. */
  const [screen, setScreen] = useState<Screen>('game');
  const [cursor, setCursor] = useState(0);
  const { conn, wrongChain, ready, signingOut, doConnect, doSwitch, doDisconnect, label } = useWallet();
  const { market, cfg } = useSdk();
  const balance = useBalance(conn?.account.address as `0x${string}` | undefined);

  // Demo mode keeps the built-in simulation; anything else reads the real
  // event contracts, so the dials, the strike and the countdown are the ones
  // a duel would actually settle against.

  /** Set by whichever list is up, so the pad's SELECT can fire the same action
   *  a click would. A ref rather than state: it changes every render and nobody
   *  needs to re-render because of it. */
  const selectRef = useRef<() => void>(() => {});
  const select = () => selectRef.current();
  const [faucetBusy, setFaucetBusy] = useState(false);

  /** Testnet collateral mints to whoever asks. Being stuck at zero with no
   *  obvious way forward is the most common way a first run dead-ends. */
  const runFaucet = async () => {
    if (!conn) return;
    setFaucetBusy(true);
    try {
      const hash = await conn.wallet.writeContract({
        chain: cfg.chain, account: conn.account,
        address: cfg.addresses.collateral, abi: faucetAbi,
        functionName: 'faucet', args: [10_000n * 10n ** BigInt(cfg.decimals)],
      });
      await market.publicClient.waitForTransactionReceipt({ hash });
    } catch { /* the row goes back to idle; the balance says the rest */ }
    finally { setFaucetBusy(false); }
  };
  // Always the real event contracts. The built-in simulation survives only as
  // the smoke test's feed — nothing a person can reach runs on invented prices.
  const engine = useMemo(() => new Engine(new LiveFeed(market)), [market]);
  const [snap, setSnap] = useState<ConsoleSnapshot | null>(null);

  useEffect(() => {
    const unsubscribe = engine.subscribe(setSnap);
    engine.start();
    return () => { unsubscribe(); engine.stop(); };
  }, [engine]);


  // The pad has keys, so the keyboard should work too. Only while a list is up:
  // on the game face the arrows mean nothing and swallowing them is rude.
  useEffect(() => {
    if (screen === 'game') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => c + 1); }
      else if (e.key === 'Enter') { e.preventDefault(); select(); }
      else if (e.key === 'Escape') { setScreen(screen === 'menu' ? 'game' : 'menu'); setCursor(0); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screen]);

  if (!snap) return null;

  // The console is not reachable without a wallet: everything in it settles
  // on-chain, and a machine you can play but not act on teaches the wrong thing.
  //
  // Derived, not a stored step. A wallet arriving opens it, signing out closes
  // it, and a wrong network holds it — with no state to fall out of step.
  //
  // The one exception is an incoming duel link. Whoever clicked it was invited
  // and should be able to READ the terms before signing in; accepting still
  // needs a wallet, and AcceptPanel asks for one there.
  const invited = Boolean(parseDuelLink(path) || parseRoomLink(path));
  const gated = ready && !invited && (!conn || wrongChain);

  const view = renderView(path, navigate);

  const show = (next: Screen) => { setScreen(next); setCursor(0); };

  // A duel needs the 30s accept margin plus time for an opponent to see it.
  const duelReady = snap.live && Boolean(engine.currentMarketId) && engine.windowLeft() > 90;

  // The wallet reads as one row and signing out as another. Folded together,
  // sign-out was something you had to guess was there.
  const walletRows: ScreenItem[] = !conn
    ? [{ key: 'wallet', label: 'Sign in', sub: 'email, social or your own wallet' }]
    : wrongChain
      ? [
          { key: 'switch', label: 'Wrong network', sub: `switch to ${cfg.chainName}` },
          { key: 'signout', label: 'Sign out', sub: 'end the session' },
        ]
      : [
          {
            key: 'wallet',
            label: 'Wallet',
            // The footer's points are the game's paper money. This is the real
            // balance a duel would actually stake.
            right: balance === null ? '…' : `${formatUnits(balance, cfg.decimals)} ${cfg.collateralSymbol}`,
            meta: `${conn.account.address.slice(0, 6)}…${conn.account.address.slice(-4)}`,
            sub: label ?? 'signed in',
            disabled: true,
          },
          {
            key: 'signout',
            label: signingOut ? 'Signing out…' : 'Sign out',
            sub: 'a refresh will not walk back in',
            disabled: signingOut,
          },
        ];

  const menuItems: ScreenItem[] = [
    { key: 'markets', label: 'Markets', sub: 'live event contracts · tune the dials' },
    {
      key: 'createRoom',
      label: 'Open a room',
      // Rooms lead. A duel needs someone to take your exact size; a room takes
      // anyone at any size, which is the version most people can actually use.
      right: duelReady ? `${snap.asset} ${snap.interval}` : undefined,
      sub: duelReady ? 'many players, either side, any size' : 'pick a market with room for one',
    },
    { key: 'rooms', label: 'My rooms', sub: 'open, running and settled' },
    {
      key: 'create',
      label: 'Create duel',
      // Straight to the market on the dials when it can hold one, so the game
      // and the product are one gesture apart. A 60s window cannot: the 30s
      // accept margin plus time for someone to actually accept does not fit,
      // and sending them there only to be told so is a wasted step.
      right: duelReady ? `${snap.asset} ${snap.interval}` : undefined,
      sub: duelReady ? 'challenge someone on this window' : 'pick a market with room for one',
    },
    { key: 'duels', label: 'My duels', sub: 'open and running' },
    { key: 'positions', label: 'Positions', sub: 'what you hold, and what is owed to you' },
    { key: 'history', label: 'History', sub: 'duels that are over' },
    // Testnet only, and only with a wallet to mint into.
    ...(cfg.faucet && conn
      ? [{
          key: 'faucet',
          label: faucetBusy ? 'Minting…' : `Get ${cfg.collateralSymbol}`,
          sub: 'the testnet token mints to whoever asks',
          disabled: faucetBusy,
        }]
      : []),
    ...walletRows,
    { key: 'play', label: 'Play', sub: 'back to the run' },
  ];

  const crt = screen === 'game' ? undefined
    : screen === 'menu' ? (
      <ScreenList
        title="Menu" right="the run"
        items={menuItems} cursor={cursor} onCursor={setCursor} dense
        bindSelect={(fire) => { selectRef.current = fire; }}
        onSelect={(i) => {
          if (i.key === 'play') show('game');
          else if (i.key === 'markets') show('markets');
          else if (i.key === 'create') {
            if (duelReady) { show('game'); navigate(`/market/${engine.currentMarketId}/duel`); }
            else show('create');
          }
          else if (i.key === 'createRoom') {
            if (duelReady) { show('game'); navigate(`/market/${engine.currentMarketId}/room`); }
            else show('createRoom');
          }
          else if (i.key === 'rooms') show('rooms');
          else if (i.key === 'duels') show('duels');
          else if (i.key === 'positions') show('positions');
          else if (i.key === 'history') show('history');
          else if (i.key === 'faucet') void runFaucet();
          else if (i.key === 'switch') doSwitch();
          else if (i.key === 'signout') {
            // All the way out: the title card, not the connect step.
            void doDisconnect().then(() => show('game'));
          }
          else doConnect();
        }}
      />
    )
    : screen === 'rooms' ? (
      <ScreenRooms
        cursor={cursor} onCursor={setCursor}
        bindSelect={(fire) => { selectRef.current = fire; }}
        onOpen={(id) => { show('game'); navigate(`/room/${id}`); }}
      />
    )
    : screen === 'positions' ? (
      <ScreenPositions
        cursor={cursor} onCursor={setCursor}
        bindSelect={(fire) => { selectRef.current = fire; }}
      />
    )
    : screen === 'history' ? (
      <ScreenHistory
        cursor={cursor} onCursor={setCursor}
        bindSelect={(fire) => { selectRef.current = fire; }}
        onOpen={(id) => { show('game'); navigate(`/duel/${id}`); }}
      />
    )
    : screen === 'duels' ? (
      <ScreenDuels
        cursor={cursor} onCursor={setCursor}
        bindSelect={(fire) => { selectRef.current = fire; }}
        onOpen={(id) => { show('game'); navigate(`/duel/${id}`); }}
      />
    )
    : (
      <ScreenMarkets
        title={screen === 'create' || screen === 'createRoom' ? 'Pick a market' : 'Markets'}
        currentMarketId={engine.currentMarketId}
        cursor={cursor} onCursor={setCursor}
        onPick={(id) => {
          if (screen === 'createRoom') { show('game'); navigate(`/market/${id}/room`); return; }
          if (screen === 'create') { show('game'); navigate(`/market/${id}/duel`); return; }
          // Markets: if it is one of the dials, tune to it — that is what a
          // console does. Anything else still leads to a duel.
          if (engine.tuneToMarket(id)) show('game');
          else { show('game'); navigate(`/market/${id}/duel`); }
        }}
        bindSelect={(fire) => { selectRef.current = fire; }}
      />
    );

  return (
    <div className="console-stage">
      <Panel hot={snap.hot && view.isGame && screen === 'game'}>
        <Marquee
          asset={snap.asset}
          interval={snap.interval}
          riders={view.isGame ? snap.riders : view.label}
          expiryLabel={snap.expiryLabel}
          strike={snap.strike}
          onOpenMenu={() => { engine.wake(); show(screen === 'game' ? 'menu' : 'game'); }}
        />

        {view.isGame ? <GameFace engine={engine} s={snap} screen={crt} /> : view.node}

        {/* Always present. The arrows step the dials on the game face and move
            the cursor on a list, so no key is ever dead — except back, which
            dims rather than vanishing, the way hardware would. */}
        {view.isGame && (
          <NavPad
            canBack={screen !== 'game'}
            onUp={() => {
              engine.wake();
              if (screen === 'game') engine.tuneStep(-1);
              else setCursor((c) => Math.max(0, c - 1));
            }}
            onDown={() => {
              engine.wake();
              if (screen === 'game') engine.tuneStep(1);
              else setCursor((c) => c + 1);
            }}
            onSelect={() => {
              engine.wake();
              if (screen === 'game') show('menu');
              else select();
            }}
            onBack={() => { engine.wake(); show(screen === 'menu' ? 'game' : 'menu'); }}
          />
        )}

        <Footer engine={engine} s={snap} />
      </Panel>
      
      {/* Nothing until Privy has finished restoring: flashing the card at
          someone who is already signed in, then snatching it away, is worse
          than a moment of the console alone. */}
      {gated && <div className="gate"><StartScreen /></div>}
    </div>
  );
}

/** Path → what the middle of the plate shows. */
function renderView(path: string, navigate: (to: string) => void) {
  const game = { isGame: true as const, node: null, label: '' };

  const link = parseDuelLink(path);
  if (link) {
    return {
      isGame: false as const,
      label: 'incoming duel',
      node: <AcceptPanel link={link} onAccepted={() => navigate(`/duel/${link.duelId}`)} />,
    };
  }

  const roomLink = parseRoomLink(path);
  if (roomLink) {
    return {
      isGame: false as const,
      label: 'a room',
      node: <RoomPanel roomId={roomLink.roomId} escrow={roomLink.escrow} onBack={() => navigate('/')} />,
    };
  }

  const room = /^\/room\/(\d+)$/.exec(path);
  if (room) {
    return {
      isGame: false as const,
      label: `room #${room[1]}`,
      node: <RoomPanel roomId={BigInt(room[1]!)} onBack={() => navigate('/')} />,
    };
  }

  const createRoom = /^\/market\/(0x[0-9a-fA-F]+)\/room$/.exec(path);
  if (createRoom) {
    return {
      isGame: false as const,
      label: 'new room',
      node: (
        <CreateRoomPanel
          marketId={createRoom[1] as `0x${string}`}
          onOpened={(id) => navigate(`/room/${id}`)}
          onBack={() => navigate('/')}
        />
      ),
    };
  }

  const duel = /^\/duel\/(\d+)$/.exec(path);
  if (duel) {
    return {
      isGame: false as const,
      label: `duel #${duel[1]}`,
      node: <DuelPanel duelId={BigInt(duel[1]!)} onBack={() => navigate('/')} />,
    };
  }

  const create = /^\/market\/(0x[0-9a-fA-F]+)\/duel$/.exec(path);
  if (create) {
    return {
      isGame: false as const,
      label: 'new duel',
      node: (
        <CreateDuelPanel
          marketId={create[1] as `0x${string}`}
          onOpened={(id) => navigate(`/duel/${id}`)}
          onBack={() => navigate('/')}
        />
      ),
    };
  }

  return game;
}
