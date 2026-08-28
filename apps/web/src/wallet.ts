import { createWalletClient, custom, type Account, type Chain, type WalletClient, type EIP1193Provider } from 'viem';

declare global {
  interface Window { ethereum?: EIP1193Provider }
}

export interface Connection {
  wallet: WalletClient;
  account: Account;
  chainId: number;
}

export async function connect(chain: Chain): Promise<Connection> {
  const provider = window.ethereum;
  if (!provider) throw new Error('No injected wallet found. Install MetaMask or Rabby.');
  const [address] = await provider.request({ method: 'eth_requestAccounts' }) as `0x${string}`[];
  if (!address) throw new Error('Wallet returned no account');
  const chainId = Number(await provider.request({ method: 'eth_chainId' }));
  const wallet = createWalletClient({ chain, transport: custom(provider), account: address });
  return { wallet, account: { address, type: 'json-rpc' } as Account, chainId };
}

/** S1 network guard. The target chain comes from config, so the same code guards
 *  testnet (50312) and mainnet (5031) — switching networks changes no source here. */
export async function switchNetwork(chain: Chain): Promise<void> {
  const provider = window.ethereum;
  if (!provider) throw new Error('No injected wallet found.');
  const hexId = `0x${chain.id.toString(16)}`;
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexId }] });
  } catch (e) {
    // 4902: chain unknown to the wallet — add it, then the switch succeeds.
    if ((e as { code?: number }).code === 4902) {
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: hexId,
          chainName: chain.name,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: [...chain.rpcUrls.default.http],
          blockExplorerUrls: chain.blockExplorers ? [chain.blockExplorers.default.url] : [],
        }],
      });
    } else throw e;
  }
}
