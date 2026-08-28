import { createWalletClient, custom, type Account, type WalletClient, type EIP1193Provider } from 'viem';
import { shannon, CHAIN_ID } from '@bullrun/sdk';

declare global {
  interface Window { ethereum?: EIP1193Provider }
}

export interface Connection {
  wallet: WalletClient;
  account: Account;
  chainId: number;
}

export async function connect(): Promise<Connection> {
  const provider = window.ethereum;
  if (!provider) throw new Error('No injected wallet found. Install MetaMask or Rabby.');
  const [address] = await provider.request({ method: 'eth_requestAccounts' }) as `0x${string}`[];
  if (!address) throw new Error('Wallet returned no account');
  const chainId = Number(await provider.request({ method: 'eth_chainId' }));
  const wallet = createWalletClient({ chain: shannon, transport: custom(provider), account: address });
  return { wallet, account: { address, type: 'json-rpc' } as Account, chainId };
}

/** S1 network guard — wrong chain must prompt a switch, never a silent wrong-network write. */
export async function switchToShannon(): Promise<void> {
  const provider = window.ethereum;
  if (!provider) throw new Error('No injected wallet found.');
  const hexId = `0x${CHAIN_ID.toString(16)}`;
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexId }] });
  } catch (e) {
    // 4902: chain unknown to the wallet — add it, then the switch succeeds.
    if ((e as { code?: number }).code === 4902) {
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: hexId,
          chainName: shannon.name,
          nativeCurrency: shannon.nativeCurrency,
          rpcUrls: [...shannon.rpcUrls.default.http],
          blockExplorerUrls: [shannon.blockExplorers!.default.url],
        }],
      });
    } else throw e;
  }
}
