// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice DreamDEX BinaryMarketsModule.
/// @dev PRD §4.2 — every signature here is VERIFY. Transcribed from documentation and
///      must be confirmed against `packages/core` of somnia-chain/dreamdex-bot-kit before
///      the escrow is deployed. `outcomeIds` in particular may not exist as a function:
///      the ids may derive as keccak(marketId, outcome) or live in the markets(marketId)
///      record. See packages/scripts/src/probe-unknowns.ts (§9 unknown #3).
interface IBinaryMarketsModule {
    function mintCompleteSet(bytes32 marketId, uint256 amount) external;
    function mergeCompleteSet(bytes32 marketId, uint256 amount) external;
    function redeem(bytes32 marketId, uint256 tokenId, uint256 amount) external;

    /// @return 0 Listed, 1 Trading, 2 Locked, 4 Resolved, 5 Voided
    function marketStatus(bytes32 marketId) external view returns (uint8);

    function outcomeIds(bytes32 marketId) external view returns (uint256 upId, uint256 downId);
}
