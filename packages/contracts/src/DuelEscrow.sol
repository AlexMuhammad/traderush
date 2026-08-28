// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/utils/ReentrancyGuard.sol";
import {IBinaryMarketsModule} from "./interfaces/IBinaryMarketsModule.sol";
import {IOutcomeToken6909} from "./interfaces/IOutcomeToken6909.sol";

/// @title DuelEscrow
/// @notice Peer-to-peer duels on DreamDEX Event Contracts.
///         Two parties stake `S` each; on accept the escrow mints `n = 2S` complete
///         sets and hands one leg to each side. The winner redeems `2S` — the pot.
/// @dev Intentionally minimal: no admin, no pause, no upgradeability.
///      Unaudited. Testnet first; the deploy is per-network.
contract DuelEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Gotcha §8.11 — accepting into a locking market reverts inside
    ///         mintCompleteSet and burns gas for both parties. Enforced here rather
    ///         than trusted to the client: `markets()` gives us the expiry, so the
    ///         chain can hold the rule itself.
    uint64 public constant MIN_DEADLINE_MARGIN = 30;

    enum Status { None, Open, Matched, Cancelled }

    struct Duel {
        address challenger;
        address opponent;
        bytes32 marketId;
        uint128 stake;           // per side
        uint64  acceptDeadline;
        bool    challengerUp;
        Status  status;
    }

    /// @dev Only the fields the escrow acts on. `markets()` returns fourteen values;
    ///      pulling them straight into a memory struct keeps the stack shallow.
    struct MarketInfo {
        address collateral;
        uint32  operatorId;
        bytes32 venueId;
        uint256 yesId;
        uint256 noId;
        uint64  tradingStart;
        uint64  expiry;
    }

    IERC20               public immutable collateral;
    IBinaryMarketsModule public immutable module;
    IOutcomeToken6909    public immutable outcome;

    uint256 public nextId = 1;
    mapping(uint256 => Duel) public duels;

    event Opened(uint256 indexed id, address indexed challenger, bytes32 indexed marketId,
                 bool challengerUp, uint128 stake, uint64 acceptDeadline);
    event Matched(uint256 indexed id, address indexed opponent, uint256 minted);
    event Cancelled(uint256 indexed id);

    error NotOpen();
    error DeadlinePassed();
    error DeadlineInPast();
    error DeadlineTooLate();
    error MarketNotTrading();
    error MarketUnknown();
    error WrongCollateral();
    error SelfDuel();
    error NotChallenger();
    error StakeZero();

    constructor(address _collateral, address _module, address _outcome) {
        collateral = IERC20(_collateral);
        module     = IBinaryMarketsModule(_module);
        outcome    = IOutcomeToken6909(_outcome);
    }

    /// @notice Escrow the challenger's stake and publish an open challenge.
    /// @dev Nothing is minted here, so an unmatched challenge is always refundable
    ///      in full (§7).
    function open(bytes32 marketId, bool challengerUp, uint128 stake, uint64 acceptDeadline)
        external nonReentrant returns (uint256 id)
    {
        if (stake == 0) revert StakeZero();
        if (acceptDeadline <= block.timestamp) revert DeadlineInPast();

        MarketInfo memory m = _market(marketId);
        _requireTradeable(m, acceptDeadline);

        collateral.safeTransferFrom(msg.sender, address(this), stake);

        id = nextId++;
        duels[id] = Duel(msg.sender, address(0), marketId, stake,
                         acceptDeadline, challengerUp, Status.Open);
        emit Opened(id, msg.sender, marketId, challengerUp, stake, acceptDeadline);
    }

    /// @notice Match a duel: pull the opponent's stake, mint the pot, split the legs.
    function accept(uint256 id) external nonReentrant {
        Duel storage d = duels[id];
        if (d.status != Status.Open)             revert NotOpen();
        if (block.timestamp >= d.acceptDeadline) revert DeadlinePassed();
        if (msg.sender == d.challenger)          revert SelfDuel();

        // Gotcha §8.1 — read the chain, not an indexer, immediately before writing.
        MarketInfo memory m = _market(d.marketId);
        _requireTradeable(m, d.acceptDeadline);

        collateral.safeTransferFrom(msg.sender, address(this), d.stake);

        d.opponent = msg.sender;
        d.status   = Status.Matched;            // state final before external calls

        // Duel arithmetic (§1): the pot is 2S, so mint n = 2S complete sets, NOT S.
        // Minting S would pay the winner half the pot and strand the rest.
        uint256 n = uint256(d.stake) * 2;
        collateral.forceApprove(address(module), n);
        module.mintCompleteSet(m.operatorId, m.venueId, d.marketId, n);

        if (d.challengerUp) {
            outcome.transfer(d.challenger, m.yesId, n);
            outcome.transfer(msg.sender,   m.noId,  n);
        } else {
            outcome.transfer(d.challenger, m.noId,  n);
            outcome.transfer(msg.sender,   m.yesId, n);
        }
        emit Matched(id, msg.sender, n);
    }

    /// @notice Refund an unmatched challenge. Challenger only before the deadline;
    ///         anyone after it, so a stake can never be stranded by an absent
    ///         challenger — and note this deliberately does NOT read the market, so
    ///         a refund cannot be blocked by anything happening at the venue.
    function cancel(uint256 id) external nonReentrant {
        Duel storage d = duels[id];
        if (d.status != Status.Open) revert NotOpen();
        if (block.timestamp < d.acceptDeadline && msg.sender != d.challenger) {
            revert NotChallenger();
        }
        d.status = Status.Cancelled;
        collateral.safeTransfer(d.challenger, d.stake);
        emit Cancelled(id);
    }

    // ------------------------------------------------------------------ internals

    /// @dev The module has no status function. A market is tradeable when the chain's
    ///      own clock is inside its window, which is a stronger read than an indexed
    ///      enum and cannot lag.
    function _requireTradeable(MarketInfo memory m, uint64 acceptDeadline) internal view {
        if (m.expiry == 0) revert MarketUnknown();
        if (address(collateral) != m.collateral) revert WrongCollateral();
        if (block.timestamp < m.tradingStart || block.timestamp >= m.expiry) {
            revert MarketNotTrading();
        }
        if (acceptDeadline + MIN_DEADLINE_MARGIN > m.expiry) revert DeadlineTooLate();
    }

    function _market(bytes32 marketId) internal view returns (MarketInfo memory m) {
        (
            , , ,
            m.collateral,
            m.operatorId,
            m.venueId,
            , , , ,
            m.yesId,
            m.noId,
            m.tradingStart,
            m.expiry
        ) = module.markets(marketId);
    }
}
