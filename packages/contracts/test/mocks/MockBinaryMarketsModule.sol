// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockERC20} from "./MockERC20.sol";
import {MockOutcomeToken6909} from "./MockOutcomeToken6909.sol";

/// @notice Stand-in for DreamDEX's BinaryMarketsModule.
/// @dev Models the caller-funded assumption behind §9 unknown #1: mintCompleteSet pulls
///      `amount` collateral from msg.sender and mints the pair TO msg.sender. If the live
///      module turns out to be minter-restricted, the §4.4 swap fallback applies and this
///      mock is what encodes the difference.
contract MockBinaryMarketsModule {
    MockERC20 public immutable collateral;
    MockOutcomeToken6909 public immutable outcome;

    mapping(bytes32 => uint8) public status;               // 0 Listed 1 Trading 2 Locked 4 Resolved 5 Voided
    mapping(bytes32 => uint256) public winningId;          // set on resolve
    mapping(bytes32 => bool) public voided;

    constructor(MockERC20 _collateral, MockOutcomeToken6909 _outcome) {
        collateral = _collateral;
        outcome = _outcome;
    }

    function setStatus(bytes32 marketId, uint8 s) external { status[marketId] = s; }

    function marketStatus(bytes32 marketId) external view returns (uint8) {
        return status[marketId];
    }

    /// @dev §9 unknown #3 — the real derivation is unverified. Tests only need it to be
    ///      deterministic and distinct per market.
    function outcomeIds(bytes32 marketId) public pure returns (uint256 upId, uint256 downId) {
        upId   = uint256(keccak256(abi.encodePacked(marketId, uint8(1))));
        downId = uint256(keccak256(abi.encodePacked(marketId, uint8(0))));
    }

    function mintCompleteSet(bytes32 marketId, uint256 amount) external {
        require(status[marketId] == 1, "not trading");
        collateral.transferFrom(msg.sender, address(this), amount);
        (uint256 upId, uint256 downId) = outcomeIds(marketId);
        outcome.mint(msg.sender, upId, amount);
        outcome.mint(msg.sender, downId, amount);
    }

    function mergeCompleteSet(bytes32 marketId, uint256 amount) external {
        (uint256 upId, uint256 downId) = outcomeIds(marketId);
        outcome.burn(msg.sender, upId, amount);
        outcome.burn(msg.sender, downId, amount);
        collateral.transfer(msg.sender, amount);
    }

    function resolve(bytes32 marketId, bool upWins) external {
        status[marketId] = 4;
        (uint256 upId, uint256 downId) = outcomeIds(marketId);
        winningId[marketId] = upWins ? upId : downId;
    }

    function voidMarket(bytes32 marketId) external {
        status[marketId] = 5;
        voided[marketId] = true;
    }

    /// @dev The loser's leg redeems 0 and MUST NOT revert (§7, §11).
    ///      Voided pays both sides 0.5 (§8.10).
    function redeem(bytes32 marketId, uint256 tokenId, uint256 amount) external {
        require(status[marketId] == 4 || status[marketId] == 5, "not settled");
        outcome.burn(msg.sender, tokenId, amount);
        uint256 payout;
        if (voided[marketId]) {
            payout = amount / 2;
        } else if (tokenId == winningId[marketId]) {
            payout = amount;
        } else {
            payout = 0;
        }
        if (payout > 0) collateral.transfer(msg.sender, payout);
    }
}
