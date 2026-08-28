// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {DuelEscrow} from "../src/DuelEscrow.sol";

/// @notice Deploys DuelEscrow to Shannon (50312).
/// @dev Addresses are NOT hard-coded (§2): pass them in from `pnpm doctor`, which
///      re-fetches them at runtime from GET /v0/markets.
///
///   COLLATERAL=0x.. MODULE=0x.. OUTCOME=0x.. PRIVATE_KEY_A=0x.. \
///   forge script script/Deploy.s.sol:Deploy --rpc-url $RPC_URL --broadcast
contract Deploy is Script {
    function run() external returns (DuelEscrow escrow) {
        address collateral = vm.envAddress("COLLATERAL");
        address module     = vm.envAddress("MODULE");
        address outcome    = vm.envAddress("OUTCOME");

        vm.startBroadcast(vm.envUint("PRIVATE_KEY_A"));
        escrow = new DuelEscrow(collateral, module, outcome);
        vm.stopBroadcast();

        console2.log("DuelEscrow:", address(escrow));
        console2.log("Put this in .env as DUEL_ESCROW_ADDRESS / VITE_DUEL_ESCROW_ADDRESS");
    }
}
