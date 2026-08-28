import { useEffect, useState } from 'react';
import { useWallet } from '../walletContext';
import { GameConsole } from './GameConsole';
import { StartScreen } from './screens/StartScreen';
import { ConnectScreen } from './screens/ConnectScreen';
import './console.css';

type Stage = 'start' | 'connect' | 'playing';

/**
 * The console's front door: title card, then the wallet, then the game.
 *
 * The console mounts immediately and keeps running underneath, so the gate is
 * an overlay rather than a separate route. That is why the machine is already
 * alive behind the title — and it means arriving at the game is a fade, not a
 * load.
 */
export function ConsoleApp({ navigate }: { navigate: (to: string) => void }) {
  const [stage, setStage] = useState<Stage>('start');
  const { conn, wrongChain } = useWallet();

  // A wallet that is already connected on the right chain has nothing to do on
  // the connect step, so it falls straight through.
  useEffect(() => {
    if (stage === 'connect' && conn && !wrongChain) setStage('playing');
  }, [stage, conn, wrongChain]);

  return (
    <div className="console-stage">
      <GameConsole navigate={navigate} />

      {stage !== 'playing' && (
        <div className="gate">
          {stage === 'start' ? (
            <StartScreen
              onStart={() => setStage('connect')}
              onDemo={() => setStage('playing')}
            />
          ) : (
            <ConnectScreen
              onBack={() => setStage('start')}
              onDemo={() => setStage('playing')}
            />
          )}
        </div>
      )}
    </div>
  );
}
