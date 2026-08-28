/** Hand-written ABIs. DuelEscrow is ours and therefore exact; the venue ABIs are
 *  transcribed from documentation and every entry is VERIFY (§4.2). */

export const duelEscrowAbi = [
  {
    type: 'function', name: 'open', stateMutability: 'nonpayable',
    inputs: [
      { name: 'marketId', type: 'bytes32' },
      { name: 'challengerUp', type: 'bool' },
      { name: 'stake', type: 'uint128' },
      { name: 'acceptDeadline', type: 'uint64' },
    ],
    outputs: [{ name: 'id', type: 'uint256' }],
  },
  {
    type: 'function', name: 'accept', stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'uint256' }], outputs: [],
  },
  {
    type: 'function', name: 'cancel', stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'uint256' }], outputs: [],
  },
  {
    type: 'function', name: 'duels', stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'challenger', type: 'address' },
      { name: 'opponent', type: 'address' },
      { name: 'marketId', type: 'bytes32' },
      { name: 'stake', type: 'uint128' },
      { name: 'acceptDeadline', type: 'uint64' },
      { name: 'challengerUp', type: 'bool' },
      { name: 'status', type: 'uint8' },
    ],
  },
  { type: 'function', name: 'nextId', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'collateral', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'module', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'outcome', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  {
    type: 'event', name: 'Opened',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'challenger', type: 'address', indexed: true },
      { name: 'marketId', type: 'bytes32', indexed: true },
      { name: 'challengerUp', type: 'bool', indexed: false },
      { name: 'stake', type: 'uint128', indexed: false },
      { name: 'acceptDeadline', type: 'uint64', indexed: false },
    ],
  },
  {
    type: 'event', name: 'Matched',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'opponent', type: 'address', indexed: true },
      { name: 'minted', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event', name: 'Cancelled',
    inputs: [{ name: 'id', type: 'uint256', indexed: true }],
  },
  { type: 'error', name: 'NotOpen', inputs: [] },
  { type: 'error', name: 'DeadlinePassed', inputs: [] },
  { type: 'error', name: 'DeadlineInPast', inputs: [] },
  { type: 'error', name: 'MarketNotTrading', inputs: [] },
  { type: 'error', name: 'SelfDuel', inputs: [] },
  { type: 'error', name: 'NotChallenger', inputs: [] },
  { type: 'error', name: 'StakeZero', inputs: [] },
] as const;

export const erc20Abi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
] as const;

/** VERIFY (§4.2, §9 unknown #3). */
export const binaryMarketsModuleAbi = [
  { type: 'function', name: 'mintCompleteSet', stateMutability: 'nonpayable', inputs: [{ name: 'marketId', type: 'bytes32' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'mergeCompleteSet', stateMutability: 'nonpayable', inputs: [{ name: 'marketId', type: 'bytes32' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'redeem', stateMutability: 'nonpayable', inputs: [{ name: 'marketId', type: 'bytes32' }, { name: 'tokenId', type: 'uint256' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'marketStatus', stateMutability: 'view', inputs: [{ name: 'marketId', type: 'bytes32' }], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'outcomeIds', stateMutability: 'view', inputs: [{ name: 'marketId', type: 'bytes32' }], outputs: [{ name: 'upId', type: 'uint256' }, { name: 'downId', type: 'uint256' }] },
] as const;

/** VERIFY (§4.2). */
export const outcomeToken6909Abi = [
  { type: 'function', name: 'transfer', stateMutability: 'nonpayable', inputs: [{ name: 'receiver', type: 'address' }, { name: 'id', type: 'uint256' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'id', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
] as const;
