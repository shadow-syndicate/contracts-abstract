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
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "./interfaces/ITRAX.sol";
import "./interfaces/IInventory.sol";

/**
 * @title Shop
 * @dev In-game shop contract for selling item lots in exchange for TRAX tokens.
 * Supports two pricing tiers: standard TRAX and TRAX Turbo (requires lootbox ownership).
 * Lots can include time-based availability and item restrictions.
 */
contract Shop is AccessControl {
    // Role for withdrawing collected funds
    bytes32 public constant WITHDRAW_ROLE = keccak256("WITHDRAW_ROLE");
    // Role for managing lots (create/update)
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

    // TRAX token used as payment currency
    ITRAX public immutable trax;
    // Inventory contract for minting purchased items
    IInventory public immutable inventory;
    // Lootbox NFT required for Turbo purchases
    IERC721 public lootbox;

    /**
     * @dev Lot structure defining a purchasable item bundle
     * @param priceInTrax Standard price in TRAX tokens
     * @param priceInTraxTurbo Discounted price for lootbox holders
     * @param startTime Unix timestamp when lot becomes available
     * @param deadline Unix timestamp when lot expires
     * @param itemIds Array of item IDs to mint on purchase
     * @param itemCounts Corresponding quantities for each item
     * @param restrictedItems Items that prevent purchase if already owned
     */
    struct Lot {
        uint256 priceInTrax;
        uint256 priceInTraxTurbo;
        uint256 startTime;
        uint256 deadline;
        uint256[] itemIds;
        uint256[] itemCounts;
        uint256[] restrictedItems;  // Items that prevent purchase if owned
    }

    // Mapping from lot ID to Lot details
    mapping(uint256 => Lot) public lots;
    // Total TRAX tokens collected through all purchases
    uint256 public totalCollected;

    /**
     * @dev Emitted when a lot is successfully purchased
     */
    event Purchase(
        address indexed buyer,
        uint256 indexed lotId,
        uint256 count,
        uint256 traxAmount,
        uint256 signId
    );

    /**
     * @dev Emitted when a new lot is created
     */
    event LotCreated(uint256 indexed lotId, uint256 price, uint256 priceTurbo, uint256 startTime, uint256 deadline);

    /**
     * @dev Emitted when an existing lot is updated
     */
    event LotUpdated(uint256 indexed lotId, uint256 price, uint256 priceTurbo, uint256 startTime, uint256 deadline);

    // Custom errors for gas-efficient reverts
    error LotNotActive(); // Lot is outside its time window
    error InsufficientPayment(); // Payment amount is less than required
    error InvalidLot(); // Lot doesn't exist or has zero price
    error AlreadyOwnsRestrictedItem(); // Buyer owns a restricted item
    error NoLootboxOwnership(); // Buyer doesn't own a lootbox for Turbo purchase
    error ArraysLengthMismatch(); // Item IDs and counts arrays have different lengths
    error RestrictedItemsCannotBeBulkPurchased(); // Cannot buy count > 1 for lots with restricted items

    /**
     * @dev Constructor to initialize the Shop contract
     * @param _trax Address of the TRAX token contract
     * @param _inventory Address of the Inventory contract
     * @param _lootbox Address of the Lootbox NFT contract
     * @param _admin Address to be granted admin and manager roles
     * @param _withdrawRole Address to be granted withdraw role
     */
    constructor(
        address _trax,
        address _inventory,
        address _lootbox,
        address _admin,
        address _withdrawRole
    ) {
        trax = ITRAX(_trax);
        inventory = IInventory(_inventory);
        lootbox = IERC721(_lootbox);
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(WITHDRAW_ROLE, _withdrawRole);
        _grantRole(MANAGER_ROLE, _admin);
    }

    /**
     * @dev Creates a new lot for sale
     * @param lotId Unique identifier for the lot
     * @param priceInTrax Standard price in TRAX tokens
     * @param priceInTraxTurbo Discounted price for lootbox holders (0 to disable)
     * @param startTime Unix timestamp when sales begin
     * @param deadline Unix timestamp when sales end
     * @param itemIds Array of item IDs to be minted on purchase
     * @param itemCounts Corresponding quantities for each item
     * @param restrictedItems Items that prevent purchase if owned
     */
    function createLot(
        uint256 lotId,
        uint256 priceInTrax,
        uint256 priceInTraxTurbo,
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
            priceInTrax: priceInTrax,
            priceInTraxTurbo: priceInTraxTurbo,
            startTime: startTime,
            deadline: deadline,
            itemIds: itemIds,
            itemCounts: itemCounts,
            restrictedItems: restrictedItems
        });

        emit LotCreated(lotId, priceInTrax, priceInTraxTurbo, startTime, deadline);
    }

    /**
     * @dev Updates an existing lot's parameters
     * @param lotId ID of the lot to update
     * @param priceInTrax New standard price
     * @param priceInTraxTurbo New turbo price
     * @param startTime New start time
     * @param deadline New deadline
     * @param itemIds New array of item IDs
     * @param itemCounts New array of item quantities
     * @param restrictedItems New array of restricted items
     */
    function updateLot(
        uint256 lotId,
        uint256 priceInTrax,
        uint256 priceInTraxTurbo,
        uint256 startTime,
        uint256 deadline,
        uint256[] memory itemIds,
        uint256[] memory itemCounts,
        uint256[] memory restrictedItems
    ) external onlyRole(MANAGER_ROLE) {
        if (itemIds.length != itemCounts.length) {
            revert ArraysLengthMismatch();
        }

        lots[lotId].priceInTrax = priceInTrax;
        lots[lotId].priceInTraxTurbo = priceInTraxTurbo;
        lots[lotId].startTime = startTime;
        lots[lotId].deadline = deadline;
        lots[lotId].itemIds = itemIds;
        lots[lotId].itemCounts = itemCounts;
        lots[lotId].restrictedItems = restrictedItems;

        emit LotUpdated(lotId, priceInTrax, priceInTraxTurbo, startTime, deadline);
    }

    /**
     * @dev Purchase a lot using standard TRAX pricing
     * @param lotId ID of the lot to purchase
     * @param count Number of times to purchase the lot
     * @param traxValue Amount of TRAX to spend
     * @param signId Signature ID for TRAX burn
     * @param sigV ECDSA signature v component
     * @param sigR ECDSA signature r component
     * @param sigS ECDSA signature s component
     */
    function buyForTRAX(
        uint256 lotId,
        uint256 count,
        uint256 traxValue,
        uint256 signId,
        uint8 sigV,
        bytes32 sigR,
        bytes32 sigS
    ) external {
        Lot memory lot = lots[lotId];

        if (lot.itemIds.length == 0) {
            revert InvalidLot();
        }

        if (traxValue < lot.priceInTrax * count) {
            revert InsufficientPayment();
        }

        _processPurchase(lot, lotId, count, traxValue, signId, sigV, sigR, sigS);
    }

    /**
     * @dev Purchase a lot using Turbo pricing (requires lootbox ownership)
     * @param lotId ID of the lot to purchase
     * @param count Number of times to purchase the lot
     * @param traxValue Amount of TRAX to spend
     * @param signId Signature ID for TRAX burn
     * @param sigV ECDSA signature v component
     * @param sigR ECDSA signature r component
     * @param sigS ECDSA signature s component
     */
    function buyForTraxTurbo(
        uint256 lotId,
        uint256 count,
        uint256 traxValue,
        uint256 signId,
        uint8 sigV,
        bytes32 sigR,
        bytes32 sigS
    ) external {
        Lot memory lot = lots[lotId];

        if (lot.itemIds.length == 0) {
            revert InvalidLot();
        }

        if (traxValue < lot.priceInTraxTurbo * count) {
            revert InsufficientPayment();
        }

        // Verify lootbox ownership for Turbo pricing eligibility
        if (lootbox.balanceOf(msg.sender) == 0) {
            revert NoLootboxOwnership();
        }

        _processPurchase(lot, lotId, count, traxValue, signId, sigV, sigR, sigS);
    }

    /**
     * @dev Internal function to process lot purchases
     * @param lot The lot being purchased
     * @param lotId ID of the lot
     * @param count Number of times to purchase the lot
     * @param traxValue Amount of TRAX being spent
     * @param signId Signature ID for TRAX burn
     * @param sigV ECDSA signature v component
     * @param sigR ECDSA signature r component
     * @param sigS ECDSA signature s component
     */
    function _processPurchase(
        Lot memory lot,
        uint256 lotId,
        uint256 count,
        uint256 traxValue,
        uint256 signId,
        uint8 sigV,
        bytes32 sigR,
        bytes32 sigS
    ) internal {
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

        // Burn TRAX tokens as payment (requires signature)
        trax.useFrom(msg.sender, traxValue, signId, 0, sigV, sigR, sigS);

        // Mint all purchased items to the buyer's inventory, multiplied by count
        if (lot.itemIds.length > 0) {
            uint256[] memory adjustedCounts = new uint256[](lot.itemCounts.length);
            for (uint256 i = 0; i < lot.itemCounts.length; i++) {
                adjustedCounts[i] = lot.itemCounts[i] * count;
            }
            inventory.mintBatch(msg.sender, lot.itemIds, adjustedCounts, "");
        }

        // Track total TRAX collected for accounting
        totalCollected += traxValue;

        emit Purchase(msg.sender, lotId, count, traxValue, signId);
    }

    /**
     * @dev Get complete information about a specific lot
     * @param lotId ID of the lot to query
     * @return priceInTrax Standard TRAX price
     * @return priceInTraxTurbo Turbo TRAX price
     * @return startTime Sale start timestamp
     * @return deadline Sale end timestamp
     * @return itemIds Array of item IDs in the lot
     * @return itemCounts Array of quantities for each item
     * @return restrictedItems Array of restricted item IDs
     */
    function getLot(uint256 lotId) external view returns (
        uint256 priceInTrax,
        uint256 priceInTraxTurbo,
        uint256 startTime,
        uint256 deadline,
        uint256[] memory itemIds,
        uint256[] memory itemCounts,
        uint256[] memory restrictedItems
    ) {
        Lot memory lot = lots[lotId];
        return (
            lot.priceInTrax,
            lot.priceInTraxTurbo,
            lot.startTime,
            lot.deadline,
            lot.itemIds,
            lot.itemCounts,
            lot.restrictedItems
        );
    }

    /**
     * @dev Update the lootbox NFT contract address
     * @param _lootbox New lootbox contract address
     */
    function setLootbox(address _lootbox) external onlyRole(DEFAULT_ADMIN_ROLE) {
        lootbox = IERC721(_lootbox);
    }
}
