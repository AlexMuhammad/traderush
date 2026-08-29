import { useEffect, useMemo, useState } from 'react';
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
import { NavMenu } from './components/NavMenu';
import { GameFace } from './GameFace';
import { ScreenMarkets } from './components/ScreenMarkets';
import { CreateDuelPanel } from './duel/CreateDuelPanel';
import { DuelPanel } from './duel/DuelPanel';
import { AcceptPanel } from './duel/AcceptPanel';
import { StartScreen } from './screens/StartScreen';
import { ConnectScreen } from './screens/ConnectScreen';
import './console.css';

type Stage = 'start' | 'connect' | 'playing';

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
  const [menuOpen, setMenuOpen] = useState(false);
  /** What the CRT is showing. The menu switches it; the game is the default. */
  const [screen, setScreen] = useState<'game' | 'markets'>('game');
  const [mount, setMount] = useState<HTMLDivElement | null>(null);
  const { conn, wrongChain } = useWallet();
  const { market } = useSdk();

  // Demo mode keeps the built-in simulation; anything else reads the real
  // event contracts, so the dials, the strike and the countdown are the ones
  // a duel would actually settle against.
  const [demo, setDemo] = useState(false);
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

  // An incoming duel link should not sit behind the title card — the person
  // clicking it was invited, not browsing.
  useEffect(() => {
    if (parseDuelLink(path)) setStage('playing');
  }, [path]);

  if (!snap) return null;

  const view = renderView(path, navigate);

  const crt = screen === 'markets' ? (
    <ScreenMarkets
      currentMarketId={engine.currentMarketId}
      onPick={(id) => {
        // If it is one of the dials, just tune to it — that is what a console
        // does. Anything else can still be duelled on.
        if (engine.tuneToMarket(id)) setScreen('game');
        else navigate(`/market/${id}/duel`);
      }}
    />
  ) : undefined;

  return (
    <div className="console-stage">
      <Panel hot={snap.hot && view.isGame} mountRef={setMount}>
        <Marquee
          asset={snap.asset}
          interval={snap.interval}
          riders={view.isGame ? snap.riders : view.label}
          expiryLabel={snap.expiryLabel}
          strike={snap.strike}
          onOpenMenu={() => { engine.wake(); setMenuOpen(true); }}
        />

        {view.isGame ? <GameFace engine={engine} s={snap} screen={crt} /> : view.node}

        <Footer engine={engine} s={snap} />

        <NavMenu
          open={menuOpen}
          onOpenChange={setMenuOpen}
          container={mount}
          onNavigate={navigate}
          onScreen={(next) => { setScreen(next); navigate('/'); }}
          screen={screen}
        />
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
