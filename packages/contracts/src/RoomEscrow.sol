// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/utils/ReentrancyGuard.sol";
import {IBinaryMarketsModule} from "./interfaces/IBinaryMarketsModule.sol";
import {IOutcomeToken6909} from "./interfaces/IOutcomeToken6909.sol";

/// @title RoomEscrow
/// @notice Many-player rooms on DreamDEX Event Contracts.
///
///         Anyone opens a room on a market and picks a side. Anyone else joins
///         either side, at any size, until entry closes. The winning side takes
///         the whole pot, split by what each of them put in.
///
///         A duel is this with two players and equal stakes; the arithmetic is
///         the same one generalised. What changes is the price: with unequal
///         sides the payout floats — 5 on UP against 3 on DOWN pays the UP side
///         1.6x and the DOWN side 2.67x. That is parimutuel, and it is the only
///         model that works without matching a counterparty to your exact size.
///
/// @dev Intentionally minimal: no admin, no pause, no upgradeability, no fees.
///      Unaudited. The deploy is per-network.
contract RoomEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Gotcha §8.11 — a mint into a locking market reverts and burns
    ///         gas. Entry has to close far enough out that the last join still
    ///         lands inside the trading window.
    uint64 public constant MIN_DEADLINE_MARGIN = 30;

    struct Room {
        bytes32 marketId;
        uint64  entryDeadline;
        uint128 totalUp;
        uint128 totalDown;
        bool    exists;
        /// @dev A one-sided room's stake has been merged back to collateral.
        bool    unwound;
    }

    /// @dev Only the fields the escrow acts on. `markets()` returns fourteen
    ///      values; pulling them into a memory struct keeps the stack shallow.
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
    mapping(uint256 => Room) public rooms;
    mapping(uint256 => mapping(address => uint128)) public upOf;
    mapping(uint256 => mapping(address => uint128)) public downOf;
    mapping(uint256 => mapping(address => bool)) public settled;

    event Opened(uint256 indexed id, address indexed creator, bytes32 indexed marketId,
                 bool up, uint128 stake, uint64 entryDeadline);
    event Joined(uint256 indexed id, address indexed player, bool up, uint128 stake,
                 uint128 totalUp, uint128 totalDown);
    event Claimed(uint256 indexed id, address indexed player, uint256 upAmount, uint256 downAmount);
    event Refunded(uint256 indexed id, address indexed player, uint128 stake);

    error NoRoom();
    error EntryClosed();
    error EntryOpen();
    error DeadlineInPast();
    error DeadlineTooLate();
    error MarketNotTrading();
    error MarketUnknown();
    error WrongCollateral();
    error StakeZero();
    error NothingToClaim();
    error RoomIsContested();
    error RoomIsOneSided();

    constructor(address _collateral, address _module, address _outcome) {
        collateral = IERC20(_collateral);
        module     = IBinaryMarketsModule(_module);
        outcome    = IOutcomeToken6909(_outcome);
    }

    /// @notice Open a room and take the first side.
    function open(bytes32 marketId, bool up, uint128 stake, uint64 entryDeadline)
        external nonReentrant returns (uint256 id)
    {
        if (entryDeadline <= block.timestamp) revert DeadlineInPast();

        MarketInfo memory m = _market(marketId);
        _requireTradeable(m, entryDeadline);

        id = nextId++;
        rooms[id] = Room(marketId, entryDeadline, 0, 0, true, false);
        _take(id, m, up, stake);

        emit Opened(id, msg.sender, marketId, up, stake, entryDeadline);
    }

    /// @notice Back a side. Any size, either side, as many times as you like,
    ///         until entry closes.
    function join(uint256 id, bool up, uint128 stake) external nonReentrant {
        Room storage r = rooms[id];
        if (!r.exists) revert NoRoom();
        if (block.timestamp >= r.entryDeadline) revert EntryClosed();

        // Gotcha §8.1 — read the chain, not an indexer, immediately before
        // writing. The window can close between a screen loading and a tap.
        MarketInfo memory m = _market(r.marketId);
        _requireTradeable(m, r.entryDeadline);

        _take(id, m, up, stake);
    }

    /// @notice Take your share of your side's outcome tokens.
    ///
    ///         The whole pot is minted as complete sets, so ALL the UP tokens
    ///         belong to the UP side and all the DOWN tokens to the DOWN side.
    ///         Your share of your side is your stake over that side's total —
    ///         which is why the winning side splits the entire pot rather than
    ///         only what the losers put in.
    ///
    ///         Backing both sides is allowed and pays out on both legs. It is a
    ///         way to lose the spread, not a trick.
    function claim(uint256 id) external nonReentrant {
        Room storage r = rooms[id];
        if (!r.exists) revert NoRoom();
        if (block.timestamp < r.entryDeadline) revert EntryOpen();
        if (r.totalUp == 0 || r.totalDown == 0) revert RoomIsOneSided();
        if (settled[id][msg.sender]) revert NothingToClaim();

        uint128 mineUp = upOf[id][msg.sender];
        uint128 mineDown = downOf[id][msg.sender];
        if (mineUp == 0 && mineDown == 0) revert NothingToClaim();

        settled[id][msg.sender] = true;

        uint256 pot = uint256(r.totalUp) + uint256(r.totalDown);
        MarketInfo memory m = _market(r.marketId);

        uint256 upAmount;
        uint256 downAmount;
        // Integer division floors, so the last few wei of a leg can be left
        // behind. Dust stays in the escrow rather than letting one claimer
        // round up into someone else's share.
        if (mineUp > 0) {
            upAmount = (pot * mineUp) / r.totalUp;
            outcome.transfer(msg.sender, m.yesId, upAmount);
        }
        if (mineDown > 0) {
            downAmount = (pot * mineDown) / r.totalDown;
            outcome.transfer(msg.sender, m.noId, downAmount);
        }

        emit Claimed(id, msg.sender, upAmount, downAmount);
    }

    /// @notice Get your stake back from a room nobody contested.
    ///
    ///         A room with every player on one side cannot pay anyone: there is
    ///         no losing side to win from. The complete sets are merged back to
    ///         collateral and everyone takes what they put in. Nothing is ever
    ///         stranded by an opponent who did not turn up.
    function refund(uint256 id) external nonReentrant {
        Room storage r = rooms[id];
        if (!r.exists) revert NoRoom();
        if (block.timestamp < r.entryDeadline) revert EntryOpen();
        if (r.totalUp != 0 && r.totalDown != 0) revert RoomIsContested();
        if (settled[id][msg.sender]) revert NothingToClaim();

        uint128 mine = r.totalUp == 0 ? downOf[id][msg.sender] : upOf[id][msg.sender];
        if (mine == 0) revert NothingToClaim();

        settled[id][msg.sender] = true;

        // Unwind once, on the first refund: burn the complete sets back into
        // the collateral that paid for them.
        if (!r.unwound) {
            r.unwound = true;
            uint256 pot = uint256(r.totalUp) + uint256(r.totalDown);
            MarketInfo memory m = _market(r.marketId);
            module.mergeCompleteSet(m.operatorId, m.venueId, r.marketId, pot);
        }

        collateral.safeTransfer(msg.sender, mine);
        emit Refunded(id, msg.sender, mine);
    }

    // ------------------------------------------------------------------ views

    /// @notice What `who` would receive from `id`, in outcome tokens per side.
    function shareOf(uint256 id, address who) external view returns (uint256 up, uint256 down) {
        Room storage r = rooms[id];
        if (!r.exists || r.totalUp == 0 || r.totalDown == 0 || settled[id][who]) return (0, 0);
        uint256 pot = uint256(r.totalUp) + uint256(r.totalDown);
        uint128 mineUp = upOf[id][who];
        uint128 mineDown = downOf[id][who];
        if (mineUp > 0) up = (pot * mineUp) / r.totalUp;
        if (mineDown > 0) down = (pot * mineDown) / r.totalDown;
    }

    // ------------------------------------------------------------------ internals

    /// @dev Pull a stake and mint its complete sets on the spot.
    ///
    ///      Minting per join rather than once when entry closes is what keeps
    ///      the room from depending on anyone showing up to "start" it. A room
    ///      that nobody starts before the window shuts would have every stake
    ///      inside it stranded; this way the mint always happens while the
    ///      market is provably trading, because a join cannot happen otherwise.
    function _take(uint256 id, MarketInfo memory m, bool up, uint128 stake) internal {
        if (stake == 0) revert StakeZero();

        collateral.safeTransferFrom(msg.sender, address(this), stake);
        collateral.forceApprove(address(module), stake);
        module.mintCompleteSet(m.operatorId, m.venueId, rooms[id].marketId, stake);

        Room storage r = rooms[id];
        if (up) {
            r.totalUp += stake;
            upOf[id][msg.sender] += stake;
        } else {
            r.totalDown += stake;
            downOf[id][msg.sender] += stake;
        }

        emit Joined(id, msg.sender, up, stake, r.totalUp, r.totalDown);
    }

    /// @dev The module has no status function. A market is tradeable when the
    ///      chain's own clock is inside its window — a stronger read than an
    ///      indexed enum, and one that cannot lag.
    function _requireTradeable(MarketInfo memory m, uint64 entryDeadline) internal view {
        if (m.expiry == 0) revert MarketUnknown();
        if (address(collateral) != m.collateral) revert WrongCollateral();
        if (block.timestamp < m.tradingStart || block.timestamp >= m.expiry) {
            revert MarketNotTrading();
        }
        if (entryDeadline + MIN_DEADLINE_MARGIN > m.expiry) revert DeadlineTooLate();
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
