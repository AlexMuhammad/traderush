// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice ERC-6909 singleton holding every outcome token id.
/// @dev PRD §4.2 — VERIFY against the bot kit.
interface IOutcomeToken6909 {
    function transfer(address receiver, uint256 id, uint256 amount) external returns (bool);
    function balanceOf(address owner, uint256 id) external view returns (uint256);
}
