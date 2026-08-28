// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DuelEscrow} from "../../src/DuelEscrow.sol";
import {MockERC20} from "./MockERC20.sol";

/// @notice Malicious opponent that tries to re-enter accept() from the ERC-6909 receive hook.
contract ReenteringReceiver {
    DuelEscrow public immutable escrow;
    uint256 public targetId;
    bool public reentered;
    bool public reentryReverted;

    constructor(DuelEscrow _escrow) { escrow = _escrow; }

    function approveAll(MockERC20 token, uint256 amount) external {
        token.approve(address(escrow), amount);
    }

    function attack(uint256 id) external {
        targetId = id;
        escrow.accept(id);
    }

    function onOutcomeReceived(address, uint256, uint256) external {
        if (reentered) return;
        reentered = true;
        try escrow.accept(targetId) {
            reentryReverted = false;
        } catch {
            reentryReverted = true;
        }
    }
}
