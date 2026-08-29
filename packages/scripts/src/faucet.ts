/** `pnpm faucet` — fund the test wallets with tUSDC.
 *
 *  Testnet collateral is TestUSDC (6 decimals) and it carries its own public
 *  `faucet(uint256)`, so no web form is involved: anyone can mint to themselves.
 *  Native STT for gas is a separate thing and does NOT come from here — see the
 *  message this prints when a wallet has none.
 *
 *  Refuses to run on mainnet, where the collateral is a real stablecoin.
 */
import { createPublicClient, createWalletClient, http, formatUnits, parseUnits, type PublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { erc20Abi } from '@traderush/sdk';
import { cfg, fmt } from './env.js';

/** TestUSDC's own faucet. Not part of the ERC-20 standard, hence a local ABI. */
const faucetAbi = [
  { type: 'function', name: 'faucet', stateMutability: 'nonpayable', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [] },
] as const;

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function main() {
  if (!cfg.faucet) {
    console.log(fmt.bad(`${cfg.network} collateral is real ${cfg.collateralSymbol} — there is no faucet.`));
    process.exit(1);
  }

  const amount = parseUnits(process.env.AMOUNT ?? '10000', cfg.decimals);
  const pub = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpcUrl) }) as PublicClient;

  const keys: { name: string; key: string }[] = [];
  for (const name of ['PRIVATE_KEY_A', 'PRIVATE_KEY_B']) {
    const key = process.env[name];
    if (key) keys.push({ name, key });
  }

  if (!keys.length) {
    console.log(fmt.bad('No PRIVATE_KEY_A / PRIVATE_KEY_B in .env — nothing to fund.'));
    process.exit(1);
  }

  console.log(fmt.head(`tUSDC faucet · ${cfg.network} · ${cfg.addresses.collateral}`));
  console.log(`minting ${formatUnits(amount, cfg.decimals)} ${cfg.collateralSymbol} per wallet\n`);

  for (const { name, key } of keys) {
    const account = privateKeyToAccount(key as `0x${string}`);
    const wallet = createWalletClient({ account, chain: cfg.chain, transport: http(cfg.rpcUrl) });
    const label = `${name} ${account.address}`;

    // Gas first: the faucet is a transaction like any other, and an empty wallet
    // fails here with a confusing error rather than an obvious one.
    const gas = await pub.getBalance({ address: account.address });
    if (gas === 0n) {
      console.log(fmt.bad(`${label}\n  no STT for gas. Get some first:`));
      console.log('    https://testnet.somnia.network/            (official faucet)');
      console.log('    https://cloud.google.com/application/web3/faucet/somnia/shannon');
      continue;
    }

    try {
      const hash = await wallet.writeContract({
        chain: cfg.chain, account,
        address: cfg.addresses.collateral, abi: faucetAbi,
        functionName: 'faucet', args: [amount],
      });
      await pub.waitForTransactionReceipt({ hash });
      const balance = await pub.readContract({
        address: cfg.addresses.collateral, abi: erc20Abi,
        functionName: 'balanceOf', args: [account.address],
      }) as bigint;
      console.log(fmt.ok(`${label}\n  ${formatUnits(balance, cfg.decimals)} ${cfg.collateralSymbol}  ·  ${hash}`));
    } catch (e) {
      console.log(fmt.bad(`${label}\n  ${msg(e)}`));
    }
  }

  console.log(fmt.head('Next'));
  console.log('  pnpm probe — §9 unknowns #1 and #2');
}

main().catch((e) => { console.error(e); process.exit(1); });
