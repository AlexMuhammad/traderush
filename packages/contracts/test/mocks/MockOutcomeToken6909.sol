// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IOutcomeReceiver {
    function onOutcomeReceived(address from, uint256 id, uint256 amount) external;
}

/// @notice ERC-6909-shaped singleton for tests.
/// @dev It calls `onOutcomeReceived` on contract receivers so the reentrancy test in
///      DuelEscrow.t.sol has a hook to attack through. Real ERC-6909 has no such hook;
///      the mock is deliberately more hostile than the venue.
contract MockOutcomeToken6909 {
    mapping(address => mapping(uint256 => uint256)) public balanceOf;
    bool public hooksEnabled;

    event Transfer(address indexed from, address indexed to, uint256 indexed id, uint256 amount);

    function setHooksEnabled(bool on) external { hooksEnabled = on; }

    function mint(address to, uint256 id, uint256 amount) external {
        balanceOf[to][id] += amount;
        emit Transfer(address(0), to, id, amount);
    }

    function burn(address from, uint256 id, uint256 amount) external {
        require(balanceOf[from][id] >= amount, "balance");
        balanceOf[from][id] -= amount;
        emit Transfer(from, address(0), id, amount);
    }

    function transfer(address receiver, uint256 id, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender][id] >= amount, "balance");
        balanceOf[msg.sender][id] -= amount;
        balanceOf[receiver][id] += amount;
        emit Transfer(msg.sender, receiver, id, amount);
        if (hooksEnabled && receiver.code.length > 0) {
            IOutcomeReceiver(receiver).onOutcomeReceived(msg.sender, id, amount);
        }
        return true;
    }
}
