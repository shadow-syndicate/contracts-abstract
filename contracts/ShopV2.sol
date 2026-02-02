// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.0.0
//
// Roach Racing Club makes trading a social and competitive game —
// play with friends, prove your edge, and win while having fun
// https://roach.fun
/*
                                                                   ..::--------::..
                                                               .:--------------------::
                                                            :----------------------------:
                                                         .:---------------------------------.
                                                        :-------------------------------------
                                                      .----------------------------------------:
                                                     :------------------------------------------:
                                                    :--===----------------------------------===--:
                                                   .--+@@@@%%#+=----------------------=+*#%@@@@+--:
                                                   ---@@@@@@@@@@@#+----------------+#@@@@@@@@@@@=--
                                                  :--+@@@@@@@@@@@@@@#+----------=#@@@@@@@@@@@@@@*--:
                                                  ---#@@@@@@@@@@@@@@@@%+------=%@@@@@@@@@@@@@@@@%---
                                                  -----==+*%@@@@@@@@@@@@%=--=#@@@@@@@@@@@@%*++=-----
                                                  -----------=*@@@@@@@@@@@*+@@@@@@@@@@@#+-----------
                                                  :-------------+%@@@@@@@@@@@@@@@@@@%+-------------:
                                                   ---------------*@@@@@@@@@@@@@@@@*---------------
                                                   :---------------=@@@@@@@@@@@@@@+---------------:
                                                    :---------------=@@@@@@@@@@@@=----------------
                                                     :---------------+@@@@@@@@@@*---------------:
                                                      :---------------%@@@@@@@@@---------------:
                                                        --------------#@@@@@@@@%--------------.
                                                         .------------#@@@@@@@@#------------.
                                                            :---------*@@@@@@@@#---------:.
                                                               :----------------------:.
                                                                     ..::--------:::.



███████╗██╗  ██╗ █████╗ ██████╗  ██████╗ ██╗    ██╗    ███████╗██╗   ██╗███╗   ██╗██████╗ ██╗ ██████╗ █████╗ ████████╗███████╗    ██╗███╗   ██╗ ██████╗
██╔════╝██║  ██║██╔══██╗██╔══██╗██╔═══██╗██║    ██║    ██╔════╝╚██╗ ██╔╝████╗  ██║██╔══██╗██║██╔════╝██╔══██╗╚══██╔══╝██╔════╝    ██║████╗  ██║██╔════╝
███████╗███████║███████║██║  ██║██║   ██║██║ █╗ ██║    ███████╗ ╚████╔╝ ██╔██╗ ██║██║  ██║██║██║     ███████║   ██║   █████╗      ██║██╔██╗ ██║██║
╚════██║██╔══██║██╔══██║██║  ██║██║   ██║██║███╗██║    ╚════██║  ╚██╔╝  ██║╚██╗██║██║  ██║██║██║     ██╔══██║   ██║   ██╔══╝      ██║██║╚██╗██║██║
███████║██║  ██║██║  ██║██████╔╝╚██████╔╝╚███╔███╔╝    ███████║   ██║   ██║ ╚████║██████╔╝██║╚██████╗██║  ██║   ██║   ███████╗    ██║██║ ╚████║╚██████╗██╗
╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝  ╚═════╝  ╚══╝╚══╝     ╚══════╝   ╚═╝   ╚═╝  ╚═══╝╚═════╝ ╚═╝ ╚═════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝    ╚═╝╚═╝  ╚═══╝ ╚═════╝╚═╝

*/

pragma solidity ^0.8.22;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/IROACH.sol";
import "./interfaces/IACID.sol";
import "./interfaces/IInventory.sol";

/**
 * @title ShopV2
 * @dev In-game shop contract for selling item lots in exchange for ACID or ROACH tokens.
 * Lots can include time-based availability and item restrictions.
 */
contract ShopV2 is AccessControl {
    // Role for withdrawing collected funds
    bytes32 public constant WITHDRAW_ROLE = keccak256("WITHDRAW_ROLE");
    // Role for managing lots (create/update)
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

    // ACID token used as payment currency (burned on purchase)
    IACID public immutable acid;
    // ROACH token used as payment currency (burned on purchase)
    IROACH public immutable roach;
    // Inventory contract for minting purchased items
    IInventory public immutable inventory;

    /**
     * @dev Lot structure defining a purchasable item bundle
     * @param priceInAcid Price in ACID tokens
     * @param priceInRoach Price in ROACH tokens
     * @param startTime Unix timestamp when lot becomes available
     * @param deadline Unix timestamp when lot expires
     * @param itemIds Array of item IDs to mint on purchase
     * @param itemCounts Corresponding quantities for each item
     * @param restrictedItems Items that prevent purchase if already owned
     */
    struct Lot {
        uint256 priceInAcid;
        uint256 priceInRoach;
        uint256 startTime;
        uint256 deadline;
        uint256[] itemIds;
        uint256[] itemCounts;
        uint256[] restrictedItems;  // Items that prevent purchase if owned
    }

    // Mapping from lot ID to Lot details
    mapping(uint256 => Lot) public lots;

    /**
     * @dev Emitted when a lot is successfully purchased with ACID
     */
    event PurchaseAcid(
        address indexed buyer,
        uint256 indexed lotId,
        uint256 count,
        uint256 acidAmount,
        uint256 signId
    );

    /**
     * @dev Emitted when a lot is successfully purchased with ROACH
     */
    event PurchaseRoach(
        address indexed buyer,
        uint256 indexed lotId,
        uint256 count,
        uint256 roachAmount,
        uint256 signId
    );

    /**
     * @dev Emitted when a new lot is created
     */
    event LotCreated(uint256 indexed lotId, uint256 priceAcid, uint256 priceRoach, uint256 startTime, uint256 deadline);

    /**
     * @dev Emitted when an existing lot is updated
     */
    event LotUpdated(uint256 indexed lotId, uint256 priceAcid, uint256 priceRoach, uint256 startTime, uint256 deadline);

    // Custom errors for gas-efficient reverts
    error LotNotActive(); // Lot is outside its time window
    error InsufficientPayment(); // Payment amount is less than required
    error InvalidLot(); // Lot doesn't exist or has zero price
    error AlreadyOwnsRestrictedItem(); // Buyer owns a restricted item
    error ArraysLengthMismatch(); // Item IDs and counts arrays have different lengths
    error RestrictedItemsCannotBeBulkPurchased(); // Cannot buy count > 1 for lots with restricted items
    error ZeroAddress(); // Required address cannot be zero
    error RoachPaymentNotAvailable(); // Lot doesn't support ROACH payment

    /**
     * @dev Constructor to initialize the ShopV2 contract
     * @param _acid Address of the ACID token contract
     * @param _roach Address of the ROACH token contract
     * @param _inventory Address of the Inventory contract
     * @param _admin Address to be granted admin and manager roles
     * @param _withdrawRole Address to be granted withdraw role
     */
    constructor(
        address _acid,
        address _roach,
        address _inventory,
        address _admin,
        address _withdrawRole
    ) {
        if (_acid == address(0)) revert ZeroAddress();
        if (_roach == address(0)) revert ZeroAddress();
        if (_inventory == address(0)) revert ZeroAddress();
        acid = IACID(_acid);
        roach = IROACH(_roach);
        inventory = IInventory(_inventory);
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(WITHDRAW_ROLE, _withdrawRole);
        _grantRole(MANAGER_ROLE, _admin);
    }

    /**
     * @dev Creates a new lot for sale
     * @param lotId Unique identifier for the lot
     * @param priceInAcid Price in ACID tokens
     * @param priceInRoach Price in ROACH tokens (0 to disable ROACH payment)
     * @param startTime Unix timestamp when sales begin
     * @param deadline Unix timestamp when sales end
     * @param itemIds Array of item IDs to be minted on purchase
     * @param itemCounts Corresponding quantities for each item
     * @param restrictedItems Items that prevent purchase if owned
     */
    function createLot(
        uint256 lotId,
        uint256 priceInAcid,
        uint256 priceInRoach,
        uint256 startTime,
        uint256 deadline,
        uint256[] memory itemIds,
        uint256[] memory itemCounts,
        uint256[] memory restrictedItems
    ) external onlyRole(MANAGER_ROLE) {
        if (itemIds.length != itemCounts.length) {
            revert ArraysLengthMismatch();
        }

        lots[lotId] = Lot({
            priceInAcid: priceInAcid,
            priceInRoach: priceInRoach,
            startTime: startTime,
            deadline: deadline,
            itemIds: itemIds,
            itemCounts: itemCounts,
            restrictedItems: restrictedItems
        });

        emit LotCreated(lotId, priceInAcid, priceInRoach, startTime, deadline);
    }

    /**
     * @dev Updates an existing lot's parameters
     * @param lotId ID of the lot to update
     * @param priceInAcid New ACID price
     * @param priceInRoach New ROACH price
     * @param startTime New start time
     * @param deadline New deadline
     * @param itemIds New array of item IDs
     * @param itemCounts New array of item quantities
     * @param restrictedItems New array of restricted items
     */
    function updateLot(
        uint256 lotId,
        uint256 priceInAcid,
        uint256 priceInRoach,
        uint256 startTime,
        uint256 deadline,
        uint256[] memory itemIds,
        uint256[] memory itemCounts,
        uint256[] memory restrictedItems
    ) external onlyRole(MANAGER_ROLE) {
        if (itemIds.length != itemCounts.length) {
            revert ArraysLengthMismatch();
        }

        lots[lotId].priceInAcid = priceInAcid;
        lots[lotId].priceInRoach = priceInRoach;
        lots[lotId].startTime = startTime;
        lots[lotId].deadline = deadline;
        lots[lotId].itemIds = itemIds;
        lots[lotId].itemCounts = itemCounts;
        lots[lotId].restrictedItems = restrictedItems;

        emit LotUpdated(lotId, priceInAcid, priceInRoach, startTime, deadline);
    }

    /**
     * @dev Purchase a lot using ACID tokens
     * @param lotId ID of the lot to purchase
     * @param count Number of times to purchase the lot
     * @param acidValue Amount of ACID to spend
     * @param signId Signature ID for ACID burn
     * @param sigV ECDSA signature v component
     * @param sigR ECDSA signature r component
     * @param sigS ECDSA signature s component
     */
    function buyForACID(
        uint256 lotId,
        uint256 count,
        uint256 acidValue,
        uint256 signId,
        uint8 sigV,
        bytes32 sigR,
        bytes32 sigS
    ) external {
        Lot memory lot = lots[lotId];

        if (lot.itemIds.length == 0) {
            revert InvalidLot();
        }

        if (acidValue < lot.priceInAcid * count) {
            revert InsufficientPayment();
        }

        _validatePurchase(lot, count);

        // Burn ACID tokens as payment (requires signature)
        acid.useFrom(msg.sender, acidValue, signId, 0, sigV, sigR, sigS);

        _mintItems(lot, count);

        emit PurchaseAcid(msg.sender, lotId, count, acidValue, signId);
    }

    /**
     * @dev Purchase a lot using ROACH tokens
     * @param lotId ID of the lot to purchase
     * @param count Number of times to purchase the lot
     * @param roachValue Amount of ROACH to spend
     * @param signId Signature ID for ROACH burn
     * @param sigV ECDSA signature v component
     * @param sigR ECDSA signature r component
     * @param sigS ECDSA signature s component
     */
    function buyForRoach(
        uint256 lotId,
        uint256 count,
        uint256 roachValue,
        uint256 signId,
        uint8 sigV,
        bytes32 sigR,
        bytes32 sigS
    ) external {
        Lot memory lot = lots[lotId];

        if (lot.itemIds.length == 0) {
            revert InvalidLot();
        }

        if (lot.priceInRoach == 0) {
            revert RoachPaymentNotAvailable();
        }

        if (roachValue < lot.priceInRoach * count) {
            revert InsufficientPayment();
        }

        _validatePurchase(lot, count);

        // Burn ROACH tokens as payment (requires signature)
        roach.useFrom(msg.sender, roachValue, signId, 0, sigV, sigR, sigS);

        _mintItems(lot, count);

        emit PurchaseRoach(msg.sender, lotId, count, roachValue, signId);
    }

    /**
     * @dev Internal function to validate purchase conditions
     * @param lot The lot being purchased
     * @param count Number of times to purchase the lot
     */
    function _validatePurchase(Lot memory lot, uint256 count) internal view {
        // Verify the lot is within its active time window
        if (block.timestamp < lot.startTime || block.timestamp > lot.deadline) {
            revert LotNotActive();
        }

        // Prevent bulk purchases of lots with restricted items
        if (count > 1 && lot.restrictedItems.length > 0) {
            revert RestrictedItemsCannotBeBulkPurchased();
        }

        // Ensure buyer doesn't own any restricted items (e.g., one-time purchase items)
        for (uint256 kindex = 0; kindex < lot.restrictedItems.length; kindex++) {
            if (inventory.balanceOf(msg.sender, lot.restrictedItems[kindex]) > 0) {
                revert AlreadyOwnsRestrictedItem();
            }
        }
    }

    /**
     * @dev Internal function to mint items to the buyer
     * @param lot The lot being purchased
     * @param count Number of times to purchase the lot
     */
    function _mintItems(Lot memory lot, uint256 count) internal {
        if (lot.itemIds.length > 0) {
            uint256[] memory adjustedCounts = new uint256[](lot.itemCounts.length);
            for (uint256 i = 0; i < lot.itemCounts.length; i++) {
                adjustedCounts[i] = lot.itemCounts[i] * count;
            }
            inventory.mintBatch(msg.sender, lot.itemIds, adjustedCounts, "");
        }
    }

    /**
     * @dev Get complete information about a specific lot
     * @param lotId ID of the lot to query
     * @return priceInAcid ACID price
     * @return priceInRoach ROACH price
     * @return startTime Sale start timestamp
     * @return deadline Sale end timestamp
     * @return itemIds Array of item IDs in the lot
     * @return itemCounts Array of quantities for each item
     * @return restrictedItems Array of restricted item IDs
     */
    function getLot(uint256 lotId) external view returns (
        uint256 priceInAcid,
        uint256 priceInRoach,
        uint256 startTime,
        uint256 deadline,
        uint256[] memory itemIds,
        uint256[] memory itemCounts,
        uint256[] memory restrictedItems
    ) {
        Lot memory lot = lots[lotId];
        return (
            lot.priceInAcid,
            lot.priceInRoach,
            lot.startTime,
            lot.deadline,
            lot.itemIds,
            lot.itemCounts,
            lot.restrictedItems
        );
    }
}
