// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice The ERC-6909 singleton every outcome token id lives on.
/// @dev Its address comes from `BinarySettlement.outcomeToken()`; `pnpm doctor`
///      prints it. Signatures taken from the SDK's generated erc6909Abi.
interface IOutcomeToken6909 {
    function transfer(address receiver, uint256 id, uint256 amount) external returns (bool);
    function balanceOf(address owner, uint256 id) external view returns (uint256);
}
