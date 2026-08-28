// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DuelEscrow} from "../src/DuelEscrow.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockOutcomeToken6909} from "./mocks/MockOutcomeToken6909.sol";
import {MockBinaryMarketsModule} from "./mocks/MockBinaryMarketsModule.sol";
import {ReenteringReceiver} from "./mocks/ReenteringReceiver.sol";

/// @notice PRD §4.3 test list, against mocks only — no network.
contract DuelEscrowTest is Test {
    MockERC20 collateral;
    MockOutcomeToken6909 outcome;
    MockBinaryMarketsModule module;
    DuelEscrow escrow;

    address alice = address(0xA11CE);
    address bob   = address(0xB0B);

    bytes32 constant MARKET = keccak256("BTC-UP-DOWN-15M-0001");
    uint128 constant STAKE  = 10e18;

    event Opened(uint256 indexed id, address indexed challenger, bytes32 indexed marketId,
                 bool challengerUp, uint128 stake, uint64 acceptDeadline);
    event Matched(uint256 indexed id, address indexed opponent, uint256 minted);
    event Cancelled(uint256 indexed id);

    function setUp() public {
        vm.warp(1_000_000);
        collateral = new MockERC20();
        outcome    = new MockOutcomeToken6909();
        module     = new MockBinaryMarketsModule(collateral, outcome);
        escrow     = new DuelEscrow(address(collateral), address(module), address(outcome));

        module.setStatus(MARKET, 1); // Trading

        collateral.mint(alice, 1_000e18);
        collateral.mint(bob,   1_000e18);
        vm.prank(alice); collateral.approve(address(escrow), type(uint256).max);
        vm.prank(bob);   collateral.approve(address(escrow), type(uint256).max);
    }

    function _deadline() internal view returns (uint64) {
        return uint64(block.timestamp + 300);
    }

    function _open(bool up) internal returns (uint256 id) {
        vm.prank(alice);
        id = escrow.open(MARKET, up, STAKE, _deadline());
    }

    // ---------------------------------------------------------------- open

    function test_open_escrowsStake_emits_incrementsNextId() public {
        uint64 dl = _deadline();
        vm.expectEmit(true, true, true, true);
        emit Opened(1, alice, MARKET, true, STAKE, dl);

        vm.prank(alice);
        uint256 id = escrow.open(MARKET, true, STAKE, dl);

        assertEq(id, 1);
        assertEq(escrow.nextId(), 2);
        assertEq(collateral.balanceOf(address(escrow)), STAKE);
        assertEq(collateral.balanceOf(alice), 1_000e18 - STAKE);

        (address ch, address op, bytes32 mid, uint128 st, uint64 ad, bool up, DuelEscrow.Status s)
            = escrow.duels(id);
        assertEq(ch, alice);
        assertEq(op, address(0));
        assertEq(mid, MARKET);
        assertEq(st, STAKE);
        assertEq(ad, dl);
        assertTrue(up);
        assertEq(uint8(s), uint8(DuelEscrow.Status.Open));
    }

    function test_open_revertsWhenMarketNotTrading() public {
        module.setStatus(MARKET, 2); // Locked
        vm.prank(alice);
        vm.expectRevert(DuelEscrow.MarketNotTrading.selector);
        escrow.open(MARKET, true, STAKE, _deadline());
    }

    function test_open_revertsDeadlineInPast() public {
        vm.prank(alice);
        vm.expectRevert(DuelEscrow.DeadlineInPast.selector);
        escrow.open(MARKET, true, STAKE, uint64(block.timestamp));
    }

    function test_open_revertsStakeZero() public {
        vm.prank(alice);
        vm.expectRevert(DuelEscrow.StakeZero.selector);
        escrow.open(MARKET, true, 0, _deadline());
    }

    // -------------------------------------------------------------- accept

    function test_accept_mintsTwiceStake_andSplitsLegs() public {
        uint256 id = _open(true);
        uint256 n = uint256(STAKE) * 2;

        vm.expectEmit(true, true, false, true);
        emit Matched(id, bob, n);
        vm.prank(bob);
        escrow.accept(id);

        (uint256 upId, uint256 downId) = module.outcomeIds(MARKET);
        // Duel arithmetic §1: pot = 2S, each side holds 2S of its own leg.
        assertEq(outcome.balanceOf(alice, upId), n);
        assertEq(outcome.balanceOf(bob, downId), n);
        assertEq(outcome.balanceOf(alice, downId), 0);
        assertEq(outcome.balanceOf(bob, upId), 0);
    }

    function test_accept_leavesEscrowWithZeroCollateral() public {
        uint256 id = _open(false);
        vm.prank(bob);
        escrow.accept(id);

        assertEq(collateral.balanceOf(address(escrow)), 0);
        assertEq(outcome.balanceOf(address(escrow), 0), 0);
        (uint256 upId, uint256 downId) = module.outcomeIds(MARKET);
        assertEq(outcome.balanceOf(address(escrow), upId), 0);
        assertEq(outcome.balanceOf(address(escrow), downId), 0);
    }

    function test_accept_challengerDown_legsSwap() public {
        uint256 id = _open(false);
        vm.prank(bob);
        escrow.accept(id);

        (uint256 upId, uint256 downId) = module.outcomeIds(MARKET);
        assertEq(outcome.balanceOf(alice, downId), uint256(STAKE) * 2);
        assertEq(outcome.balanceOf(bob, upId), uint256(STAKE) * 2);
    }

    function test_accept_revertsSelfDuel() public {
        uint256 id = _open(true);
        vm.prank(alice);
        vm.expectRevert(DuelEscrow.SelfDuel.selector);
        escrow.accept(id);
    }

    function test_accept_revertsAfterDeadline() public {
        uint256 id = _open(true);
        vm.warp(block.timestamp + 301);
        vm.prank(bob);
        vm.expectRevert(DuelEscrow.DeadlinePassed.selector);
        escrow.accept(id);
    }

    function test_accept_revertsWhenNotOpen() public {
        uint256 id = _open(true);
        vm.prank(bob);
        escrow.accept(id);

        address carol = address(0xC0);
        collateral.mint(carol, 100e18);
        vm.prank(carol); collateral.approve(address(escrow), type(uint256).max);
        vm.prank(carol);
        vm.expectRevert(DuelEscrow.NotOpen.selector);
        escrow.accept(id);
    }

    function test_accept_revertsWhenMarketNotTrading() public {
        uint256 id = _open(true);
        module.setStatus(MARKET, 2); // Locked — gotcha §8.11
        vm.prank(bob);
        vm.expectRevert(DuelEscrow.MarketNotTrading.selector);
        escrow.accept(id);
    }

    function test_accept_unknownIdReverts() public {
        vm.prank(bob);
        vm.expectRevert(DuelEscrow.NotOpen.selector);
        escrow.accept(999);
    }

    // -------------------------------------------------------------- cancel

    function test_cancel_beforeDeadline_challengerOnly() public {
        uint256 id = _open(true);

        vm.prank(bob);
        vm.expectRevert(DuelEscrow.NotChallenger.selector);
        escrow.cancel(id);

        vm.expectEmit(true, false, false, false);
        emit Cancelled(id);
        vm.prank(alice);
        escrow.cancel(id);

        // §7 — unmatched duel refunds exactly S; nothing was ever minted.
        assertEq(collateral.balanceOf(alice), 1_000e18);
        assertEq(collateral.balanceOf(address(escrow)), 0);
    }

    function test_cancel_afterDeadline_anyone() public {
        uint256 id = _open(true);
        vm.warp(block.timestamp + 301);

        vm.prank(bob);
        escrow.cancel(id);
        assertEq(collateral.balanceOf(alice), 1_000e18);
    }

    function test_cancel_afterAccept_revertsNotOpen() public {
        uint256 id = _open(true);
        vm.prank(bob);
        escrow.accept(id);

        vm.prank(alice);
        vm.expectRevert(DuelEscrow.NotOpen.selector);
        escrow.cancel(id);
    }

    function test_cancel_twiceReverts() public {
        uint256 id = _open(true);
        vm.prank(alice);
        escrow.cancel(id);
        vm.prank(alice);
        vm.expectRevert(DuelEscrow.NotOpen.selector);
        escrow.cancel(id);
    }

    // --------------------------------------------------------- reentrancy

    function test_accept_cannotBeReentered() public {
        outcome.setHooksEnabled(true);
        ReenteringReceiver attacker = new ReenteringReceiver(escrow);
        collateral.mint(address(attacker), 100e18);
        attacker.approveAll(collateral, type(uint256).max);

        uint256 id = _open(true);
        attacker.attack(id);

        assertTrue(attacker.reentered(), "hook never fired - test is not exercising the guard");
        assertTrue(attacker.reentryReverted(), "accept was re-entered");

        (uint256 upId, uint256 downId) = module.outcomeIds(MARKET);
        assertEq(outcome.balanceOf(address(attacker), downId), uint256(STAKE) * 2);
        assertEq(outcome.balanceOf(address(attacker), upId), 0);
        assertEq(collateral.balanceOf(address(escrow)), 0);
    }

    // -------------------------------------------------- settlement (§11 edges)

    function test_winnerRedeemsWholePot_loserRedeemsZeroWithoutReverting() public {
        uint256 id = _open(true);
        vm.prank(bob);
        escrow.accept(id);

        uint256 n = uint256(STAKE) * 2;
        (uint256 upId, uint256 downId) = module.outcomeIds(MARKET);
        module.resolve(MARKET, true); // Up wins — Alice

        uint256 aliceBefore = collateral.balanceOf(alice);
        vm.prank(alice);
        module.redeem(MARKET, upId, n);
        assertEq(collateral.balanceOf(alice) - aliceBefore, n, "winner takes the whole pot");

        // §11 — the loser's leg must redeem 0 without reverting.
        uint256 bobBefore = collateral.balanceOf(bob);
        vm.prank(bob);
        module.redeem(MARKET, downId, n);
        assertEq(collateral.balanceOf(bob), bobBefore);
    }

    function test_voidedRefundsBothSidesHalf() public {
        uint256 id = _open(true);
        vm.prank(bob);
        escrow.accept(id);

        uint256 n = uint256(STAKE) * 2;
        (uint256 upId, uint256 downId) = module.outcomeIds(MARKET);
        module.voidMarket(MARKET); // §8.10 — "called off", not a loss

        uint256 a0 = collateral.balanceOf(alice);
        uint256 b0 = collateral.balanceOf(bob);
        vm.prank(alice); module.redeem(MARKET, upId, n);
        vm.prank(bob);   module.redeem(MARKET, downId, n);

        assertEq(collateral.balanceOf(alice) - a0, STAKE, "each side gets its own stake back");
        assertEq(collateral.balanceOf(bob) - b0, STAKE);
    }

    // ----------------------------------------------------------- fuzz

    function testFuzz_acceptAlwaysMintsTwiceStake(uint128 stake) public {
        stake = uint128(bound(uint256(stake), 1, 500e18));
        collateral.mint(alice, stake);
        collateral.mint(bob, stake);

        vm.prank(alice);
        uint256 id = escrow.open(MARKET, true, stake, _deadline());
        vm.prank(bob);
        escrow.accept(id);

        (uint256 upId, uint256 downId) = module.outcomeIds(MARKET);
        assertEq(outcome.balanceOf(alice, upId), uint256(stake) * 2);
        assertEq(outcome.balanceOf(bob, downId), uint256(stake) * 2);
        assertEq(collateral.balanceOf(address(escrow)), 0);
    }
}
