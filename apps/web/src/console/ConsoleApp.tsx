import { useEffect, useMemo, useRef, useState } from 'react';
import { parseDuelLink } from '@bullrun/sdk';
import { useWallet } from '../walletContext';
import { useSdk } from '../sdk';
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
import { CreateDuelPanel } from './duel/CreateDuelPanel';
import { DuelPanel } from './duel/DuelPanel';
import { AcceptPanel } from './duel/AcceptPanel';
import { StartScreen } from './screens/StartScreen';
import { ConnectScreen } from './screens/ConnectScreen';
import './console.css';

type Stage = 'start' | 'connect' | 'playing';
/** What the CRT shows. `create` is the market list in pick-for-duel mode. */
type Screen = 'game' | 'menu' | 'markets' | 'create' | 'duels';

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
  const [stage, setStage] = useState<Stage>('start');
  /** What the CRT is showing. The menu key opens `menu`; the game is default. */
  const [screen, setScreen] = useState<Screen>('game');
  const [cursor, setCursor] = useState(0);
  const { conn, wrongChain, doConnect, doSwitch, doDisconnect, label } = useWallet();
  const { market, cfg } = useSdk();

  // Demo mode keeps the built-in simulation; anything else reads the real
  // event contracts, so the dials, the strike and the countdown are the ones
  // a duel would actually settle against.
  const [demo, setDemo] = useState(false);
  /** Set by whichever list is up, so the pad's SELECT can fire the same action
   *  a click would. A ref rather than state: it changes every render and nobody
   *  needs to re-render because of it. */
  const selectRef = useRef<() => void>(() => {});
  const select = () => selectRef.current();
  const engine = useMemo(
    () => new Engine(demo ? undefined : new LiveFeed(market)),
    [demo, market],
  );
  const [snap, setSnap] = useState<ConsoleSnapshot | null>(null);

  useEffect(() => {
    const unsubscribe = engine.subscribe(setSnap);
    engine.start();
    return () => { unsubscribe(); engine.stop(); };
  }, [engine]);

  // A wallet already connected on the right chain has nothing to do on the
  // connect step, so it falls straight through.
  useEffect(() => {
    if (stage === 'connect' && conn && !wrongChain) setStage('playing');
  }, [stage, conn, wrongChain]);

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

  // An incoming duel link should not sit behind the title card — the person
  // clicking it was invited, not browsing.
  useEffect(() => {
    if (parseDuelLink(path)) setStage('playing');
  }, [path]);

  if (!snap) return null;

  const view = renderView(path, navigate);

  const show = (next: Screen) => { setScreen(next); setCursor(0); };

  const walletRow: ScreenItem = conn
    ? wrongChain
      ? { key: 'wallet', label: 'Wrong network', sub: `tap to switch to ${cfg.chainName}` }
      : {
          key: 'wallet',
          label: 'Wallet',
          right: `${conn.account.address.slice(0, 6)}…${conn.account.address.slice(-4)}`,
          sub: `${label ?? 'signed in'} · tap to sign out`,
        }
    : { key: 'wallet', label: 'Sign in', sub: 'email, social or your own wallet' };

  const menuItems: ScreenItem[] = [
    { key: 'markets', label: 'Markets', sub: 'live event contracts · tune the dials' },
    { key: 'create', label: 'Create duel', sub: 'pick a market and challenge someone' },
    { key: 'duels', label: 'My duels', sub: 'open, live and settled' },
    walletRow,
    { key: 'play', label: 'Play', sub: 'back to the run' },
  ];

  const crt = screen === 'game' ? undefined
    : screen === 'menu' ? (
      <ScreenList
        title="Menu" right="the run"
        items={menuItems} cursor={cursor} onCursor={setCursor}
        bindSelect={(fire) => { selectRef.current = fire; }}
        onSelect={(i) => {
          if (i.key === 'play') show('game');
          else if (i.key === 'markets') show('markets');
          else if (i.key === 'create') show('create');
          else if (i.key === 'duels') show('duels');
          else if (!conn) doConnect();
          else if (wrongChain) doSwitch();
          else doDisconnect();
        }}
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
        title={screen === 'create' ? 'Pick a market' : 'Markets'}
        currentMarketId={engine.currentMarketId}
        cursor={cursor} onCursor={setCursor}
        onPick={(id) => {
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

      <p className="console-hint">
        Banteng menguasai wilayah atas, beruang wilayah bawah.
        Mereka tidak bisa menyeberang — kamu yang masuk.
      </p>

      {stage !== 'playing' && (
        <div className="gate">
          {stage === 'start' ? (
            <StartScreen
              onStart={() => setStage('connect')}
              onDemo={() => { setDemo(true); setStage('playing'); }}
            />
          ) : (
            <ConnectScreen
              onBack={() => setStage('start')}
              onDemo={() => { setDemo(true); setStage('playing'); }}
            />
          )}
        </div>
      )}
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
