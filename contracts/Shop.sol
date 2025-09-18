// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/ITRAX.sol";
import "./interfaces/IInventory.sol";

contract Shop is AccessControl {
    bytes32 public constant WITHDRAW_ROLE = keccak256("WITHDRAW_ROLE");
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

    ITRAX public immutable trax;
    IInventory public immutable inventory;

    struct Lot {
        uint256 priceInTrax;
        uint256 startTime;
        uint256 deadline;
        uint256[] itemIds;
        uint256[] itemCounts;
        uint256[] restrictedItems;  // Items that prevent purchase if owned
    }

    mapping(uint256 => Lot) public lots;
    uint256 public totalCollected;

    event Purchase(
        address indexed buyer,
        uint256 indexed lotId,
        uint256 traxAmount,
        uint256 signId
    );

    event LotCreated(uint256 indexed lotId, uint256 price, uint256 startTime, uint256 deadline);
    event LotUpdated(uint256 indexed lotId, uint256 price, uint256 startTime, uint256 deadline);

    error LotNotActive();
    error InsufficientPayment();
    error InvalidLot();
    error AlreadyOwnsRestrictedItem();

    constructor(
        address _trax,
        address _inventory,
        address _admin,
        address _withdrawRole
    ) {
        trax = ITRAX(_trax);
        inventory = IInventory(_inventory);
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(WITHDRAW_ROLE, _withdrawRole);
        _grantRole(MANAGER_ROLE, _admin);
    }

    function createLot(
        uint256 lotId,
        uint256 priceInTrax,
        uint256 startTime,
        uint256 deadline,
        uint256[] memory itemIds,
        uint256[] memory itemCounts,
        uint256[] memory restrictedItems
    ) external onlyRole(MANAGER_ROLE) {
        require(itemIds.length == itemCounts.length, "Arrays length mismatch");

        lots[lotId] = Lot({
            priceInTrax: priceInTrax,
            startTime: startTime,
            deadline: deadline,
            itemIds: itemIds,
            itemCounts: itemCounts,
            restrictedItems: restrictedItems
        });

        emit LotCreated(lotId, priceInTrax, startTime, deadline);
    }

    function updateLot(
        uint256 lotId,
        uint256 priceInTrax,
        uint256 startTime,
        uint256 deadline,
        uint256[] memory itemIds,
        uint256[] memory itemCounts,
        uint256[] memory restrictedItems
    ) external onlyRole(MANAGER_ROLE) {
        require(itemIds.length == itemCounts.length, "Arrays length mismatch");

        lots[lotId].priceInTrax = priceInTrax;
        lots[lotId].startTime = startTime;
        lots[lotId].deadline = deadline;
        lots[lotId].itemIds = itemIds;
        lots[lotId].itemCounts = itemCounts;
        lots[lotId].restrictedItems = restrictedItems;

        emit LotUpdated(lotId, priceInTrax, startTime, deadline);
    }

    function buyForTRAX(
        uint256 lotId,
        uint256 traxValue,
        uint256 signId,
        uint8 sigV,
        bytes32 sigR,
        bytes32 sigS
    ) external {
        Lot memory lot = lots[lotId];

        if (lot.priceInTrax == 0) {
            revert InvalidLot();
        }

        if (block.timestamp < lot.startTime || block.timestamp > lot.deadline) {
            revert LotNotActive();
        }

        if (traxValue < lot.priceInTrax) {
            revert InsufficientPayment();
        }

        // Check if buyer owns any restricted items
        for (uint256 i = 0; i < lot.restrictedItems.length; i++) {
            if (inventory.balanceOf(msg.sender, lot.restrictedItems[i]) > 0) {
                revert AlreadyOwnsRestrictedItem();
            }
        }

        // Burn TRAX from the buyer using useFrom
        trax.useFrom(msg.sender, traxValue, signId, 0, sigV, sigR, sigS);

        // Mint the inventory items to the buyer
        if (lot.itemIds.length > 0) {
            inventory.mintBatch(msg.sender, lot.itemIds, lot.itemCounts, "");
        }

        totalCollected += traxValue;

        emit Purchase(msg.sender, lotId, traxValue, signId);
    }

    function getLot(uint256 lotId) external view returns (
        uint256 priceInTrax,
        uint256 startTime,
        uint256 deadline,
        uint256[] memory itemIds,
        uint256[] memory itemCounts,
        uint256[] memory restrictedItems
    ) {
        Lot memory lot = lots[lotId];
        return (
            lot.priceInTrax,
            lot.startTime,
            lot.deadline,
            lot.itemIds,
            lot.itemCounts,
            lot.restrictedItems
        );
    }
}