/** TestUSDC's own faucet. Not part of the ERC-20 standard, hence a local ABI.
 *
 *  Shared by the menu row and the deposit screen: two copies of an ABI drift,
 *  and the second one to drift fails at the wallet with no explanation. */
export const faucetAbi = [
  { type: 'function', name: 'faucet', stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }], outputs: [] },
] as const;

/** What the faucet hands out in one press. */
export const FAUCET_UNITS = 10_000n;
