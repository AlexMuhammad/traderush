// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {RoomEscrow} from "../src/RoomEscrow.sol";

/// @notice Deploys RoomEscrow.
/// @dev Addresses are NOT hard-coded: `pnpm doctor` prints the command with them
///      filled in. OUTCOME is the ERC-6909 singleton, which is NOT the module —
///      it comes from `BinarySettlement.outcomeToken()`. Passing the module here
///      deploys fine and then fails on the first leg transfer.
///
///      Forge's gas estimate is roughly 17x low on Somnia (docs/FINDINGS.md 8),
///      so the package script carries a large multiplier. When a deploy mines
///      with `gasUsed == gasLimit` and `status 0`, that is out of gas, not a
///      reverting constructor.
contract DeployRoom is Script {
    function run() external returns (RoomEscrow escrow) {
        address collateral = vm.envAddress("COLLATERAL");
        address module     = vm.envAddress("MODULE");
        address outcome    = vm.envAddress("OUTCOME");

        vm.startBroadcast(vm.envUint("PRIVATE_KEY_A"));
        escrow = new RoomEscrow(collateral, module, outcome);
        vm.stopBroadcast();

        console2.log("RoomEscrow:", address(escrow));
        console2.log("Put this in .env as ROOM_ESCROW_ADDRESS_<NETWORK>");
    }
}
