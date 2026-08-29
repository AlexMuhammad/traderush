/** DuelEscrow's ABI is ours and therefore exact.
 *
 *  The VENUE ABIs are NOT transcribed any more — they are re-exported straight
 *  from @somnia-chain/markets-sdk, which is generated from the deployed
 *  contracts. Transcribing them by hand is exactly what PRD §4.2 warned about,
 *  and every signature we had transcribed turned out to be wrong:
 *
 *    assumed  mintCompleteSet(bytes32 marketId, uint256 amount)
 *    actual   mintCompleteSet(uint32 operatorId, bytes32 venueId,
 *                             bytes32 marketId, uint256 amount)
 *
 *    assumed  marketStatus(bytes32) -> uint8
 *    actual   does not exist. `markets(bytes32)` returns the whole record,
 *             including tradingStart/expiry, which is what status derives from.
 *
 *    assumed  outcomeIds(bytes32) -> (uint256, uint256)
 *    actual   does not exist. `markets(bytes32)` carries yesId/noId, and they
 *             equal outcomeId(pool, nonce, idx).
 *
 *    assumed  redeem(bytes32, uint256 tokenId, uint256 amount)
 *    actual   redeem(uint32 operatorId, bytes32 venueId, bytes32 marketId,
 *                    uint8 outcomeIdx, uint256 amount)
 *
 *  See docs/FINDINGS.md. */
export {
  binaryModuleReadAbi,
  binaryModuleWriteAbi,
  binarySettlementAbi,
  erc6909Abi,
} from '@somnia-chain/markets-sdk';

/** Field order of `binaryModule.markets(bytes32)`. Named so a caller reads
 *  `record[MARKET.expiry]` instead of `record[13]`. */
export const MARKET = {
  oracleQuestionId: 0, outcomeSlotCount: 1, voidPolicy: 2, collateral: 3,
  originOperatorId: 4, originVenueId: 5, oracleAdapter: 6, creator: 7,
  market: 8, pool: 9, yesId: 10, noId: 11, tradingStart: 12, expiry: 13,
} as const;

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
  { type: 'function', name: 'MIN_DEADLINE_MARGIN', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint64' }] },
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
  { type: 'error', name: 'DeadlineTooLate', inputs: [] },
  { type: 'error', name: 'MarketUnknown', inputs: [] },
  { type: 'error', name: 'WrongCollateral', inputs: [] },
  { type: 'error', name: 'MarketNotTrading', inputs: [] },
  { type: 'error', name: 'SelfDuel', inputs: [] },
  { type: 'error', name: 'NotChallenger', inputs: [] },
  { type: 'error', name: 'StakeZero', inputs: [] },
] as const;

export const erc20Abi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'transfer', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
] as const;

