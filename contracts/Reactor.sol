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

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./interfaces/IInventory.sol";

/**
 * @title Reactor
 * @dev Contract for Reactor upgrades and activations.
 * Allows users to upgrade reactors by burning batteries and the current reactor
 * to obtain the next-level reactor. Each upgrade triggers a time-limited boost period
 * during which no further upgrades are allowed.
 * Reactors follow a sequential upgrade path with configurable limits.
 */
contract Reactor is Initializable, AccessControlUpgradeable, UUPSUpgradeable {
    // Role for managing reactor configuration
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

    // Inventory contract for minting/burning items
    IInventory public inventory;
    // Activation duration in seconds for each battery type (0 = battery not enabled)
    mapping(uint256 => uint256) public batteryActivationDuration;
    // Minimum reactor ID in the upgrade sequence
    uint256 public minReactorId;
    // Maximum reactor ID in the upgrade sequence
    uint256 public maxReactorId;
    // Step increment between reactor levels (e.g., 1 for sequential)
    uint256 public reactorIdStep;
    // Activation step increment (default 1)
    uint256 public constant activationStep = 1;
    // Maximum number of activations allowed per reactor line
    uint256 public activationCount;

    // Mapping from user address to their activation expiry timestamp
    mapping(address => uint256) public activeUntil;
    // Track battery usage history per reactor per user (user -> reactorId -> array of batteryIds used)
    mapping(address => mapping(uint256 => uint256[])) public batteryUsageHistory;
    // Reactor ID offset for each battery type (determines which reactor branch to mint)
    mapping(uint256 => uint256) public batteryReactorOffset;
    // Array of all configured battery item IDs
    uint256[] public configuredBatteryIds;

    /**
     * @dev Emitted when a reactor is successfully activated/upgraded
     */
    event Activated(
        address indexed account,
        uint256 indexed burnedItemId,
        uint256 indexed mintedItemId,
        uint256 batteryItemId,
        uint256 activatedAt,
        uint256 activeUntil
    );

    /**
     * @dev Emitted when a battery item ID is added or removed
     */
    event BatteryItemSet(uint256 indexed batteryItemId, uint256 duration);

    /**
     * @dev Emitted when reactor range configuration is updated
     */
    event ReactorRangeSet(uint256 minId, uint256 maxId, uint256 step, uint256 count);

    /**
     * @dev Emitted when a battery reactor offset is configured
     */
    event BatteryReactorOffsetSet(uint256 indexed batteryItemId, uint256 offset);

    // Custom errors for gas-efficient reverts
    error ItemNotOwned(); // User doesn't own required item
    error InvalidReactorId(); // Reactor ID is not valid for activation
    error InvalidBatteryId(); // Battery ID is not enabled
    error MaxActivationsReached(); // Reactor has reached max upgrade level
    error ActivationStillActive(); // Previous activation hasn't expired yet

    /**
     * @dev Constructor that disables initializers to prevent implementation contract initialization
     */
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Initialize the Reactor contract (replaces constructor for upgradeable pattern)
     * @param _inventory Address of the Inventory contract
     * @param _admin Address to be granted admin and manager roles
     * @param _batteryItemIds Array of battery item IDs that can be used for activation
     * @param _batteryDurations Array of activation durations for each battery type
     * @param _batteryReactorOffsets Array of reactor ID offsets for each battery type
     * @param _minReactorId Starting reactor ID in the sequence
     * @param _maxReactorId Maximum reactor ID in the sequence
     * @param _reactorIdStep Increment between reactor levels
     * @param _activationCount Maximum upgrades allowed per reactor line
     */
    function initialize(
        address _inventory,
        address _admin,
        uint256[] memory _batteryItemIds,
        uint256[] memory _batteryDurations,
        uint256[] memory _batteryReactorOffsets,
        uint256 _minReactorId,
        uint256 _maxReactorId,
        uint256 _reactorIdStep,
        uint256 _activationCount
    ) public initializer {
        require(_batteryItemIds.length == _batteryDurations.length, "Array length mismatch");
        require(_batteryItemIds.length == _batteryReactorOffsets.length, "Array length mismatch");

        __AccessControl_init();
        __UUPSUpgradeable_init();

        inventory = IInventory(_inventory);
        configuredBatteryIds = _batteryItemIds;
        for (uint256 i = 0; i < _batteryItemIds.length; i++) {
            _setBatteryItem(_batteryItemIds[i], _batteryDurations[i]);
            batteryReactorOffset[_batteryItemIds[i]] = _batteryReactorOffsets[i];
        }
        minReactorId = _minReactorId;
        maxReactorId = _maxReactorId;
        reactorIdStep = _reactorIdStep;
        activationCount = _activationCount;
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(MANAGER_ROLE, _admin);
    }

    /**
     * @dev Function that authorizes contract upgrades
     * @param newImplementation Address of the new implementation contract
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    /**
     * @dev Internal function to set a battery item ID
     * @param _batteryItemId Battery item ID to configure
     * @param _duration Activation duration for this battery type (0 to disable)
     */
    function _setBatteryItem(uint256 _batteryItemId, uint256 _duration) internal {
        batteryActivationDuration[_batteryItemId] = _duration;
        emit BatteryItemSet(_batteryItemId, _duration);
    }

    /**
     * @dev Add or remove a battery item ID
     * @param _batteryItemId Battery item ID to configure
     * @param _duration Activation duration for this battery type (0 to disable)
     */
    function setBatteryItem(uint256 _batteryItemId, uint256 _duration) external onlyRole(MANAGER_ROLE) {
        _setBatteryItem(_batteryItemId, _duration);
    }

    /**
     * @dev Configure the reactor upgrade sequence parameters
     * @param _minReactorId Starting reactor ID
     * @param _maxReactorId Maximum reactor ID
     * @param _reactorIdStep Increment between levels
     * @param _activationCount Max upgrades allowed
     */
    function setReactorRange(
        uint256 _minReactorId,
        uint256 _maxReactorId,
        uint256 _reactorIdStep,
        uint256 _activationCount
    ) external onlyRole(MANAGER_ROLE) {
        minReactorId = _minReactorId;
        maxReactorId = _maxReactorId;
        reactorIdStep = _reactorIdStep;
        activationCount = _activationCount;
        emit ReactorRangeSet(_minReactorId, _maxReactorId, _reactorIdStep, _activationCount);
    }

    /**
     * @dev Configure the reactor ID offset for a specific battery type
     * @param _batteryItemId Battery item ID to configure
     * @param _offset Reactor ID offset for this battery type
     */
    function setBatteryReactorOffset(uint256 _batteryItemId, uint256 _offset) external onlyRole(MANAGER_ROLE) {
        batteryReactorOffset[_batteryItemId] = _offset;
        emit BatteryReactorOffsetSet(_batteryItemId, _offset);
    }

    /**
     * @dev Get the current activation level for a reactor item
     * @param reactorItemId Reactor item ID to check
     * @return uint256 Current activation level (0 to activationCount)
     */
    function getCurrentActivationLevel(uint256 reactorItemId) public view returns (uint256) {
        return (reactorItemId % reactorIdStep) / activationStep;
    }

    /**
     * @dev Get the base reactor series ID (strips activation level)
     * @param reactorItemId Reactor item ID
     * @return uint256 Base reactor series ID
     */
    function getReactorSeries(uint256 reactorItemId) public view returns (uint256) {
        return reactorItemId - (reactorItemId % reactorIdStep);
    }

    /**
     * @dev Get the reactor offset based on battery usage history for a user and reactor series
     * @param user User address to check
     * @param reactorItemId Reactor item ID to check
     * @return uint256 The maximum reactor offset from all batteries used in this reactor series
     */
    function getOffsetFromActivationHistory(
        address user,
        uint256 reactorItemId
    ) public view returns (uint256) {
        uint256 seriesId = getReactorSeries(reactorItemId);
        uint256 maxOffset = 0;

        // Check history for all possible itemIds in this series (for backward compatibility)
        // Old code stored history per itemId (2000, 2001, 2002, 2003)
        // New code stores by seriesId (2000), but we need to read both
        for (uint256 i = 0; i < activationCount; i++) {
            uint256[] memory history = batteryUsageHistory[user][seriesId + i];
            for (uint256 j = 0; j < history.length; j++) {
                uint256 offset = batteryReactorOffset[history[j]];
                if (offset > maxOffset) {
                    maxOffset = offset;
                }
            }
        }

        return maxOffset;
    }

    /**
     * @dev Check if a reactor item can be activated/upgraded
     * @param reactorItemId Reactor item ID to check
     * @return bool True if the reactor can be upgraded
     */
    function canActivate(uint256 reactorItemId) public view returns (bool) {
        // Verify itemId is within the valid reactor range
        if (reactorItemId < minReactorId || reactorItemId > maxReactorId + activationCount) {
            return false;
        }

        // Calculate the current activation level for this reactor
        uint256 activations = getCurrentActivationLevel(reactorItemId);

        // Ensure we haven't reached the maximum upgrade level
        return activations < activationCount;
    }

    /**
     * @dev Activate/upgrade a reactor by burning battery and current reactor
     * @param reactorItemId Current reactor item ID to upgrade
     * @param batteryItemId Battery item ID to use for activation
     */
    function activate(uint256 reactorItemId, uint256 batteryItemId) external {
        // Ensure previous activation has expired before allowing new upgrade
        if (activeUntil[msg.sender] > block.timestamp) {
            revert ActivationStillActive();
        }

        // Verify the reactor is eligible for upgrade
        if (!canActivate(reactorItemId)) {
            revert InvalidReactorId();
        }

        // Verify the battery item is valid (has non-zero duration)
        uint256 activationDuration = batteryActivationDuration[batteryItemId];
        if (activationDuration == 0) {
            revert InvalidBatteryId();
        }

        // Verify ownership of the reactor to be upgraded
        if (inventory.balanceOf(msg.sender, reactorItemId) == 0) {
            revert ItemNotOwned();
        }

        // Verify ownership of battery required for activation
        if (inventory.balanceOf(msg.sender, batteryItemId) == 0) {
            revert ItemNotOwned();
        }

        // Consume battery as upgrade cost
        inventory.burnAdmin(msg.sender, batteryItemId, 1, "");

        // Burn the current reactor
        inventory.burnAdmin(msg.sender, reactorItemId, 1, "");

        // Track battery usage for this reactor series (use base ID to accumulate history)
        uint256 seriesId = getReactorSeries(reactorItemId);
        batteryUsageHistory[msg.sender][seriesId].push(batteryItemId);

        // Get the current activation level for this reactor
        uint256 currentActivationLevel = getCurrentActivationLevel(reactorItemId);

        // Calculate and mint the upgraded reactor
        // Apply battery offset only on the last activation (when reaching activationCount)
        uint256 newItemId;
        if (currentActivationLevel == activationCount - 1) {
            // Last activation: apply battery offset based on activation history
            uint256 offset = getOffsetFromActivationHistory(msg.sender, reactorItemId);
            newItemId = reactorItemId + activationStep + offset;
        } else {
            // Regular activation: just increment by activation step
            newItemId = reactorItemId + activationStep;
        }
        inventory.mint(msg.sender, newItemId, 1, "");

        uint256 activatedAt = block.timestamp;
        uint256 expiryTime = activatedAt + activationDuration;

        // Record activation expiry to prevent immediate re-activation
        activeUntil[msg.sender] = expiryTime;

        emit Activated(msg.sender, reactorItemId, newItemId, batteryItemId, activatedAt, expiryTime);
    }
}
