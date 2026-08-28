// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/utils/ReentrancyGuard.sol";
import {IBinaryMarketsModule} from "./interfaces/IBinaryMarketsModule.sol";
import {IOutcomeToken6909} from "./interfaces/IOutcomeToken6909.sol";

/// @title DuelEscrow
/// @notice Peer-to-peer duel layer on top of DreamDEX Event Contracts.
///         Two parties stake `S` each; on accept the escrow mints `n = 2S` complete sets
///         and hands one leg to each side. The winner redeems `2S` USDso — the whole pot.
/// @dev Intentionally minimal: no admin, no pause, no upgradeability.
///      Unaudited. Shannon testnet (chain 50312) only.
contract DuelEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status { None, Open, Matched, Cancelled }

    struct Duel {
        address challenger;
        address opponent;
        bytes32 marketId;
        uint128 stake;           // per side
        uint64  acceptDeadline;  // >= 30s before market expiry (enforced by the SDK, gotcha §8.11)
        bool    challengerUp;
        Status  status;
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
    error MarketNotTrading();
    error SelfDuel();
    error NotChallenger();
    error StakeZero();

    constructor(address _collateral, address _module, address _outcome) {
        collateral = IERC20(_collateral);
        module     = IBinaryMarketsModule(_module);
        outcome    = IOutcomeToken6909(_outcome);
    }

    /// @notice Escrow the challenger's stake and publish an open challenge.
    /// @dev Nothing is minted here — an unmatched duel is always refundable in full (§7).
    function open(bytes32 marketId, bool challengerUp, uint128 stake, uint64 acceptDeadline)
        external nonReentrant returns (uint256 id)
    {
        if (stake == 0) revert StakeZero();
        if (acceptDeadline <= block.timestamp) revert DeadlineInPast();
        // Gotcha §8.1 — read on-chain status before every write; the indexer lags by seconds.
        if (module.marketStatus(marketId) != 1) revert MarketNotTrading();

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
        // Gotcha §8.1 / §8.11 — accepting into a locking market reverts inside
        // mintCompleteSet and burns gas for both parties. Check status first.
        if (module.marketStatus(d.marketId) != 1) revert MarketNotTrading();

        collateral.safeTransferFrom(msg.sender, address(this), d.stake);

        d.opponent = msg.sender;
        d.status   = Status.Matched;            // state final before external calls

        // Duel arithmetic (§1): pot = 2S, so mint n = 2S complete sets, NOT S.
        // Minting S would pay the winner half the pot and strand the rest.
        uint256 n = uint256(d.stake) * 2;
        collateral.forceApprove(address(module), n);
        module.mintCompleteSet(d.marketId, n);

        (uint256 upId, uint256 downId) = module.outcomeIds(d.marketId);
        if (d.challengerUp) {
            outcome.transfer(d.challenger, upId,   n);
            outcome.transfer(msg.sender,   downId, n);
        } else {
            outcome.transfer(d.challenger, downId, n);
            outcome.transfer(msg.sender,   upId,   n);
        }
        emit Matched(id, msg.sender, n);
    }

    /// @notice Refund an unmatched challenge. Challenger only before the deadline;
    ///         anyone after it, so a stake can never be stranded by an absent challenger.
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
}
