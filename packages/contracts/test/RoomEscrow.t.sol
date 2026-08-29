// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {RoomEscrow} from "../src/RoomEscrow.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockOutcomeToken6909} from "./mocks/MockOutcomeToken6909.sol";
import {MockBinaryMarketsModule} from "./mocks/MockBinaryMarketsModule.sol";

/// @notice Rooms: many players, either side, any size.
///         The arithmetic to prove is that the winning side takes the WHOLE pot
///         split by stake — not just what the losers put in.
contract RoomEscrowTest is Test {
    MockERC20 collateral;
    MockOutcomeToken6909 outcome;
    MockBinaryMarketsModule module;
    RoomEscrow escrow;

    address alice = address(0xA11CE);
    address bob   = address(0xB0B);
    address carol = address(0xCA401);
    address dave  = address(0xDA7E);

    bytes32 constant MARKET  = keccak256("BTC-UP-DOWN-5M-0001");
    address constant POOL    = 0x7eDA47f9B2B44881FA36C8A4569CE4B5C24221Cc;
    uint64  constant NONCE   = 42;
    uint32  constant OPERATOR = 2;
    bytes32 constant VENUE   = bytes32(uint256(0x679795));
    uint64  constant WINDOW  = 900;

    uint128 constant ONE = 1e18;
    uint64 expiry;

    function setUp() public {
        vm.warp(1_000_000);
        collateral = new MockERC20();
        outcome    = new MockOutcomeToken6909();
        module     = new MockBinaryMarketsModule(collateral, outcome);
        escrow     = new RoomEscrow(address(collateral), address(module), address(outcome));

        expiry = uint64(block.timestamp) + WINDOW;
        module.register(MARKET, POOL, NONCE, uint64(block.timestamp), expiry, OPERATOR, VENUE);

        for (uint256 i = 0; i < 4; i++) {
            address who = [alice, bob, carol, dave][i];
            collateral.mint(who, 1_000 * ONE);
            vm.prank(who);
            collateral.approve(address(escrow), type(uint256).max);
        }
    }

    function _deadline() internal view returns (uint64) { return expiry - 60; }

    function _ids() internal view returns (uint256 upId, uint256 downId) {
        upId = module.outcomeIdFor(MARKET, 0);
        downId = module.outcomeIdFor(MARKET, 1);
    }

    /// @dev Alice 3 + Carol 2 on UP, Bob 3 on DOWN. Pot 8.
    function _room() internal returns (uint256 id) {
        vm.prank(alice);
        id = escrow.open(MARKET, true, 3 * ONE, _deadline());
        vm.prank(bob);
        escrow.join(id, false, 3 * ONE);
        vm.prank(carol);
        escrow.join(id, true, 2 * ONE);
    }

    // ------------------------------------------------------------------ entry

    function test_open_takesTheStakeAndMintsIt() public {
        vm.prank(alice);
        uint256 id = escrow.open(MARKET, true, 3 * ONE, _deadline());

        assertEq(collateral.balanceOf(alice), 997 * ONE);
        // The stake is minted on the spot, so the escrow holds sets, not cash.
        assertEq(collateral.balanceOf(address(escrow)), 0);
        (uint256 upId, uint256 downId) = _ids();
        assertEq(outcome.balanceOf(address(escrow), upId), 3 * ONE);
        assertEq(outcome.balanceOf(address(escrow), downId), 3 * ONE);

        (, , uint128 totalUp, uint128 totalDown, bool exists,) = escrow.rooms(id);
        assertEq(totalUp, 3 * ONE);
        assertEq(totalDown, 0);
        assertTrue(exists);
    }

    function test_manyPlayersOnBothSides() public {
        uint256 id = _room();
        (, , uint128 totalUp, uint128 totalDown, ,) = escrow.rooms(id);
        assertEq(totalUp, 5 * ONE);
        assertEq(totalDown, 3 * ONE);
        assertEq(escrow.upOf(id, alice), 3 * ONE);
        assertEq(escrow.upOf(id, carol), 2 * ONE);
        assertEq(escrow.downOf(id, bob), 3 * ONE);
    }

    function test_joinRevertsAfterEntryCloses() public {
        uint256 id = _room();
        vm.warp(_deadline());
        vm.prank(dave);
        vm.expectRevert(RoomEscrow.EntryClosed.selector);
        escrow.join(id, true, ONE);
    }

    function test_joinRevertsOnUnknownRoom() public {
        vm.prank(bob);
        vm.expectRevert(RoomEscrow.NoRoom.selector);
        escrow.join(99, true, ONE);
    }

    function test_openRevertsWhenDeadlineTooCloseToExpiry() public {
        vm.prank(alice);
        vm.expectRevert(RoomEscrow.DeadlineTooLate.selector);
        escrow.open(MARKET, true, ONE, expiry - 29);
    }

    function test_openRevertsOnWrongCollateral() public {
        module.setCollateral(MARKET, address(0xBEEF));
        vm.prank(alice);
        vm.expectRevert(RoomEscrow.WrongCollateral.selector);
        escrow.open(MARKET, true, ONE, _deadline());
    }

    function test_openRevertsAfterTheWindowShuts() public {
        vm.warp(expiry + 1);
        vm.prank(alice);
        vm.expectRevert(RoomEscrow.MarketNotTrading.selector);
        escrow.open(MARKET, true, ONE, uint64(block.timestamp + 5));
    }

    function test_stakeZeroReverts() public {
        vm.prank(alice);
        vm.expectRevert(RoomEscrow.StakeZero.selector);
        escrow.open(MARKET, true, 0, _deadline());
    }

    // ------------------------------------------------------------------ claim

    /// @dev THE property. The UP side put in 5 of an 8 pot; between them they
    ///      must receive all 8 of the UP leg, split 3:2.
    function test_winningSideSplitsTheWholePot() public {
        uint256 id = _room();
        vm.warp(_deadline());
        (uint256 upId, uint256 downId) = _ids();

        vm.prank(alice); escrow.claim(id);
        vm.prank(carol); escrow.claim(id);
        vm.prank(bob);   escrow.claim(id);

        // 8 * 3/5 and 8 * 2/5 — the whole UP leg between them.
        assertEq(outcome.balanceOf(alice, upId), (8 * ONE * 3) / 5);
        assertEq(outcome.balanceOf(carol, upId), (8 * ONE * 2) / 5);
        assertEq(
            outcome.balanceOf(alice, upId) + outcome.balanceOf(carol, upId),
            8 * ONE
        );
        // Bob alone on DOWN takes the entire DOWN leg.
        assertEq(outcome.balanceOf(bob, downId), 8 * ONE);
        assertEq(outcome.balanceOf(address(escrow), upId), 0);
        assertEq(outcome.balanceOf(address(escrow), downId), 0);
    }

    /// @dev 3 staked into a pot of 8 across a side holding 5 pays 1.6x; the
    ///      lone backer of the other side gets 2.67x. That is the trade rooms
    ///      make for never needing a matching counterparty.
    function test_payoutsAreParimutuel() public {
        uint256 id = _room();
        vm.warp(_deadline());
        module.resolve(MARKET, true);           // UP wins

        vm.prank(alice); escrow.claim(id);
        (uint256 upId,) = _ids();
        uint256 won = outcome.balanceOf(alice, upId);

        uint256 before = collateral.balanceOf(alice);
        vm.prank(alice);
        module.redeem(OPERATOR, VENUE, MARKET, 0, won);
        assertEq(collateral.balanceOf(alice) - before, (8 * ONE * 3) / 5);   // 4.8 on a 3 stake
    }

    function test_loserClaimsAndRedeemsZeroWithoutReverting() public {
        uint256 id = _room();
        vm.warp(_deadline());
        module.resolve(MARKET, true);           // UP wins, Bob loses

        vm.prank(bob); escrow.claim(id);
        (, uint256 downId) = _ids();
        uint256 held = outcome.balanceOf(bob, downId);
        assertEq(held, 8 * ONE);

        uint256 before = collateral.balanceOf(bob);
        vm.prank(bob);
        module.redeem(OPERATOR, VENUE, MARKET, 1, held);   // must not revert
        assertEq(collateral.balanceOf(bob), before);
    }

    function test_claimRevertsBeforeEntryCloses() public {
        uint256 id = _room();
        vm.prank(alice);
        vm.expectRevert(RoomEscrow.EntryOpen.selector);
        escrow.claim(id);
    }

    function test_claimTwiceReverts() public {
        uint256 id = _room();
        vm.warp(_deadline());
        vm.prank(alice); escrow.claim(id);
        vm.prank(alice);
        vm.expectRevert(RoomEscrow.NothingToClaim.selector);
        escrow.claim(id);
    }

    function test_nonPlayerCannotClaim() public {
        uint256 id = _room();
        vm.warp(_deadline());
        vm.prank(dave);
        vm.expectRevert(RoomEscrow.NothingToClaim.selector);
        escrow.claim(id);
    }

    /// @dev Backing both sides is allowed. It pays out on both legs and is a
    ///      way to lose the spread, not a trick.
    function test_backingBothSidesPaysBothLegs() public {
        vm.prank(alice);
        uint256 id = escrow.open(MARKET, true, 2 * ONE, _deadline());
        vm.prank(alice); escrow.join(id, false, ONE);
        vm.prank(bob);   escrow.join(id, false, ONE);

        vm.warp(_deadline());
        (uint256 upId, uint256 downId) = _ids();
        vm.prank(alice); escrow.claim(id);

        // Pot 4. Alice holds all of UP, and half of DOWN.
        assertEq(outcome.balanceOf(alice, upId), 4 * ONE);
        assertEq(outcome.balanceOf(alice, downId), 2 * ONE);
    }

    function test_shareOfMatchesWhatClaimPays() public {
        uint256 id = _room();
        vm.warp(_deadline());
        (uint256 quotedUp, uint256 quotedDown) = escrow.shareOf(id, alice);
        vm.prank(alice); escrow.claim(id);
        (uint256 upId, uint256 downId) = _ids();
        assertEq(outcome.balanceOf(alice, upId), quotedUp);
        assertEq(outcome.balanceOf(alice, downId), quotedDown);
    }

    // ----------------------------------------------------------------- refund

    /// @dev Nobody took the other side, so there is nothing to win. The sets are
    ///      merged back and everyone takes out exactly what they put in.
    function test_oneSidedRoomRefundsEveryoneExactly() public {
        vm.prank(alice);
        uint256 id = escrow.open(MARKET, true, 3 * ONE, _deadline());
        vm.prank(carol); escrow.join(id, true, 2 * ONE);

        vm.warp(_deadline());
        vm.prank(alice); escrow.refund(id);
        vm.prank(carol); escrow.refund(id);

        assertEq(collateral.balanceOf(alice), 1_000 * ONE);
        assertEq(collateral.balanceOf(carol), 1_000 * ONE);
        assertEq(collateral.balanceOf(address(escrow)), 0);
    }

    function test_refundRevertsWhenTheRoomWasContested() public {
        uint256 id = _room();
        vm.warp(_deadline());
        vm.prank(alice);
        vm.expectRevert(RoomEscrow.RoomIsContested.selector);
        escrow.refund(id);
    }

    function test_claimRevertsOnAOneSidedRoom() public {
        vm.prank(alice);
        uint256 id = escrow.open(MARKET, true, ONE, _deadline());
        vm.warp(_deadline());
        vm.prank(alice);
        vm.expectRevert(RoomEscrow.RoomIsOneSided.selector);
        escrow.claim(id);
    }

    function test_refundRevertsBeforeEntryCloses() public {
        vm.prank(alice);
        uint256 id = escrow.open(MARKET, true, ONE, _deadline());
        vm.prank(alice);
        vm.expectRevert(RoomEscrow.EntryOpen.selector);
        escrow.refund(id);
    }

    // ------------------------------------------------------------------ fuzz

    /// @dev However the sides are weighted, the winning side's holdings add up
    ///      to the whole pot, give or take the dust integer division leaves.
    function testFuzz_theWholePotReachesTheWinningSide(uint128 a, uint128 b, uint128 c) public {
        a = uint128(bound(uint256(a), 1e6, 100 * ONE));
        b = uint128(bound(uint256(b), 1e6, 100 * ONE));
        c = uint128(bound(uint256(c), 1e6, 100 * ONE));

        vm.prank(alice);
        uint256 id = escrow.open(MARKET, true, a, _deadline());
        vm.prank(carol); escrow.join(id, true, b);
        vm.prank(bob);   escrow.join(id, false, c);

        vm.warp(_deadline());
        vm.prank(alice); escrow.claim(id);
        vm.prank(carol); escrow.claim(id);

        (uint256 upId,) = _ids();
        uint256 pot = uint256(a) + uint256(b) + uint256(c);
        uint256 paid = outcome.balanceOf(alice, upId) + outcome.balanceOf(carol, upId);
        assertLe(paid, pot);
        assertGe(paid, pot - 2);      // at most one wei of dust per claimer
    }
}
