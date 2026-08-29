// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice DreamDEX BinaryMarketsModule.
/// @dev NOT transcribed. Taken from the ABI that @somnia-chain/markets-sdk generates
///      from the deployed contracts, and cross-checked against the live module on
///      Shannon (0x3ecC694Cef705358864a646142ac17A90E29e388) on 2026-08-29.
///
///      The first cut of this file WAS transcribed from documentation, and every
///      signature in it was wrong: mintCompleteSet took two arguments instead of
///      four, and marketStatus/outcomeIds do not exist at all. See docs/FINDINGS.md.
interface IBinaryMarketsModule {
    /// @notice The market's whole record.
    /// @dev There is no status function on this module. Status IS the trading
    ///      window: open at `tradingStart`, shut at `expiry`.
    function markets(bytes32 marketId)
        external
        view
        returns (
            uint256 oracleQuestionId,
            uint8 outcomeSlotCount,
            uint8 voidPolicy,
            address collateral,
            uint32 originOperatorId,
            bytes32 originVenueId,
            address oracleAdapter,
            address creator,
            address market,
            address pool,
            uint256 yesId,
            uint256 noId,
            uint64 tradingStart,
            uint64 expiry
        );

    /// @notice Turns `amount` collateral into `amount` YES + `amount` NO, to msg.sender.
    /// @dev Scoped by the market's ORIGIN venue, not by whichever venue you read it
    ///      through. Both come out of `markets()`.
    function mintCompleteSet(uint32 operatorId, bytes32 venueId, bytes32 marketId, uint256 amount)
        external;

    /// @notice The inverse of mintCompleteSet: burns `amount` of BOTH outcomes
    ///         and returns `amount` collateral. Lets a room that nobody
    ///         contested unwind cleanly instead of stranding its stakes.
    function mergeCompleteSet(uint32 operatorId, bytes32 venueId, bytes32 marketId, uint256 amount)
        external;

    /// @notice Burns `amount` of one outcome and pays out whatever it settled for.
    /// @param outcomeIdx 0 = YES/UP, 1 = NO/DOWN.
    function redeem(uint32 operatorId, bytes32 venueId, bytes32 marketId, uint8 outcomeIdx, uint256 amount)
        external;
}
