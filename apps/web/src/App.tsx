import { SdkProvider } from './sdk';
import { WalletProvider } from './walletContext';
import { ConsoleApp } from './console/ConsoleApp';

/** One front end. The console IS the application — markets, duels, settlement
 *  and the game are panels on the same machine, not a console beside a plainer
 *  site. Routing lives in ConsoleApp, which decides what the plate shows. */
export function App() {
  return (
    <SdkProvider>
      <WalletProvider>
        <ConsoleApp />
      </WalletProvider>
    </SdkProvider>
  );
}
