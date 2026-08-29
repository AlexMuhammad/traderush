// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockERC20} from "./MockERC20.sol";
import {MockOutcomeToken6909} from "./MockOutcomeToken6909.sol";

/// @notice Stand-in for the deployed BinaryMarketsModule.
/// @dev Mirrors the REAL interface — four-argument mintCompleteSet, a `markets()`
///      record, no status function — so the tests exercise the same shape the
///      chain does. Outcome ids follow the venue's own scheme:
///      `id = (uint160(pool) << 72) | (nonce << 8) | idx`.
///
///      It models the caller-funded assumption behind §9 unknown #1: mintCompleteSet
///      pulls collateral from msg.sender and mints the pair TO msg.sender. If the
///      live module turns out to be minter-restricted, the §4.4 swap fallback
///      applies and this mock is where the difference gets encoded.
contract MockBinaryMarketsModule {
    struct Market {
        address collateral;
        uint32  operatorId;
        bytes32 venueId;
        address pool;
        uint64  nonce;
        uint64  tradingStart;
        uint64  expiry;
        bool    registered;
    }

    MockERC20 public immutable collateralToken;
    MockOutcomeToken6909 public immutable outcome;

    mapping(bytes32 => Market) internal _markets;
    mapping(bytes32 => uint256) public winningId;
    mapping(bytes32 => bool) public voided;
    mapping(bytes32 => bool) public settled;

    constructor(MockERC20 _collateral, MockOutcomeToken6909 _outcome) {
        collateralToken = _collateral;
        outcome = _outcome;
    }

    // ------------------------------------------------------------------ set-up

    function register(
        bytes32 marketId,
        address pool,
        uint64 nonce,
        uint64 tradingStart,
        uint64 expiry,
        uint32 operatorId,
        bytes32 venueId
    ) external {
        _markets[marketId] = Market({
            collateral: address(collateralToken),
            operatorId: operatorId,
            venueId: venueId,
            pool: pool,
            nonce: nonce,
            tradingStart: tradingStart,
            expiry: expiry,
            registered: true
        });
    }

    /// @dev For the wrong-collateral guard.
    function setCollateral(bytes32 marketId, address token) external {
        _markets[marketId].collateral = token;
    }

    function setWindow(bytes32 marketId, uint64 tradingStart, uint64 expiry) external {
        _markets[marketId].tradingStart = tradingStart;
        _markets[marketId].expiry = expiry;
    }

    // -------------------------------------------------------------------- reads

    function outcomeIdFor(bytes32 marketId, uint8 idx) public view returns (uint256) {
        Market storage m = _markets[marketId];
        return (uint256(uint160(m.pool)) << 72) | (uint256(m.nonce) << 8) | uint256(idx);
    }

    /// @notice The real module's fourteen-value record.
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
        )
    {
        Market storage m = _markets[marketId];
        return (
            uint256(marketId),
            2,
            0,
            m.collateral,
            m.operatorId,
            m.venueId,
            address(0),
            address(0),
            m.pool,
            m.pool,
            outcomeIdFor(marketId, 0),
            outcomeIdFor(marketId, 1),
            m.tradingStart,
            m.expiry
        );
    }

    // ------------------------------------------------------------------- writes

    function mintCompleteSet(uint32 operatorId, bytes32 venueId, bytes32 marketId, uint256 amount)
        external
    {
        Market storage m = _markets[marketId];
        require(m.registered, "unknown market");
        // The venue scoping is real: passing the wrong origin must not work.
        require(operatorId == m.operatorId && venueId == m.venueId, "wrong venue");
        require(block.timestamp >= m.tradingStart && block.timestamp < m.expiry, "not trading");

        collateralToken.transferFrom(msg.sender, address(this), amount);
        outcome.mint(msg.sender, outcomeIdFor(marketId, 0), amount);
        outcome.mint(msg.sender, outcomeIdFor(marketId, 1), amount);
    }

    function mergeCompleteSet(uint32 operatorId, bytes32 venueId, bytes32 marketId, uint256 amount)
        external
    {
        Market storage mk = _markets[marketId];
        require(operatorId == mk.operatorId && venueId == mk.venueId, "wrong venue");
        outcome.burn(msg.sender, outcomeIdFor(marketId, 0), amount);
        outcome.burn(msg.sender, outcomeIdFor(marketId, 1), amount);
        collateralToken.transfer(msg.sender, amount);
    }

    function resolve(bytes32 marketId, bool upWins) external {
        settled[marketId] = true;
        winningId[marketId] = outcomeIdFor(marketId, upWins ? 0 : 1);
    }

    function voidMarket(bytes32 marketId) external {
        settled[marketId] = true;
        voided[marketId] = true;
    }

    /// @dev The loser's leg redeems 0 and MUST NOT revert (§7, §11).
    ///      Voided pays both sides 0.5 (§8.10).
    function redeem(uint32, bytes32, bytes32 marketId, uint8 outcomeIdx, uint256 amount) external {
        require(settled[marketId], "not settled");
        uint256 tokenId = outcomeIdFor(marketId, outcomeIdx);
        outcome.burn(msg.sender, tokenId, amount);

        uint256 payout;
        if (voided[marketId]) payout = amount / 2;
        else if (tokenId == winningId[marketId]) payout = amount;

        if (payout > 0) collateralToken.transfer(msg.sender, payout);
    }
}
