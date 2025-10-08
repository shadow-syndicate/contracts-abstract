// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/IInventory.sol";

/**
 * @title Reactor
 * @dev Reactor upgrade and activation contract. Allows users to upgrade reactors by burning
 * batteries and the current reactor to receive the next level reactor. Each upgrade activates
 * a time-limited boost period during which no further upgrades are allowed.
 * Reactors follow a sequential upgrade pattern with configurable limits.
 */
contract Reactor is AccessControl {
    // Role for managing reactor configuration
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

    // Inventory contract for minting/burning items
    IInventory public immutable inventory;
    // Set of battery item IDs that can be used for activation
    mapping(uint256 => bool) public batteryItemIds;
    // Minimum reactor ID in the upgrade sequence
    uint256 public minReactorId;
    // Maximum reactor ID in the upgrade sequence
    uint256 public maxReactorId;
    // Step increment between reactor levels (e.g., 1 for sequential)
    uint256 public reactorIdStep;
    // Maximum number of activations allowed per reactor line
    uint256 public activationCount;
    // Duration in seconds that activation remains active
    uint256 public activationDuration;

    // Mapping from user address to their activation expiry timestamp
    mapping(address => uint256) public activeUntil;

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
    event BatteryItemSet(uint256 indexed batteryItemId, bool enabled);

    /**
     * @dev Emitted when reactor range configuration is updated
     */
    event ReactorRangeSet(uint256 minId, uint256 maxId, uint256 step, uint256 count);

    // Custom errors for gas-efficient reverts
    error ItemNotOwned(); // User doesn't own required item
    error InvalidReactorId(); // Reactor ID is not valid for activation
    error InvalidBatteryId(); // Battery ID is not enabled
    error MaxActivationsReached(); // Reactor has reached max upgrade level
    error ActivationStillActive(); // Previous activation hasn't expired yet

    /**
     * @dev Constructor to initialize the Reactor contract
     * @param _inventory Address of the Inventory contract
     * @param _admin Address to be granted admin and manager roles
     * @param _batteryItemIds Array of battery item IDs that can be used for activation
     * @param _minReactorId Starting reactor ID in the sequence
     * @param _maxReactorId Maximum reactor ID in the sequence
     * @param _reactorIdStep Increment between reactor levels
     * @param _activationCount Maximum upgrades allowed per reactor line
     * @param _activationDuration Time in seconds activation remains active
     */
    constructor(
        address _inventory,
        address _admin,
        uint256[] memory _batteryItemIds,
        uint256 _minReactorId,
        uint256 _maxReactorId,
        uint256 _reactorIdStep,
        uint256 _activationCount,
        uint256 _activationDuration
    ) {
        inventory = IInventory(_inventory);
        for (uint256 i = 0; i < _batteryItemIds.length; i++) {
            _setBatteryItem(_batteryItemIds[i], true);
        }
        minReactorId = _minReactorId;
        maxReactorId = _maxReactorId;
        reactorIdStep = _reactorIdStep;
        activationCount = _activationCount;
        activationDuration = _activationDuration;
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(MANAGER_ROLE, _admin);
    }

    /**
     * @dev Internal function to set a battery item ID
     * @param _batteryItemId Battery item ID to enable/disable
     * @param _enabled Whether to enable or disable this battery item
     */
    function _setBatteryItem(uint256 _batteryItemId, bool _enabled) internal {
        batteryItemIds[_batteryItemId] = _enabled;
        emit BatteryItemSet(_batteryItemId, _enabled);
    }

    /**
     * @dev Add or remove a battery item ID
     * @param _batteryItemId Battery item ID to enable/disable
     * @param _enabled Whether to enable or disable this battery item
     */
    function setBatteryItem(uint256 _batteryItemId, bool _enabled) external onlyRole(MANAGER_ROLE) {
        _setBatteryItem(_batteryItemId, _enabled);
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
     * @dev Update the activation duration
     * @param _activationDuration New duration in seconds
     */
    function setActivationDuration(uint256 _activationDuration) external onlyRole(MANAGER_ROLE) {
        activationDuration = _activationDuration;
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
        uint256 activations = reactorItemId % reactorIdStep;

        // Ensure we haven't reached the maximum upgrade level
        return activations < activationCount;
    }

    /**
     * @dev Activate/upgrade a reactor by burning battery and current reactor
     * @param itemId Current reactor item ID to upgrade
     * @param batteryItemId Battery item ID to use for activation
     */
    function activate(uint256 itemId, uint256 batteryItemId) external {
        // Ensure previous activation has expired before allowing new upgrade
        if (activeUntil[msg.sender] > block.timestamp) {
            revert ActivationStillActive();
        }

        // Verify the reactor is eligible for upgrade
        if (!canActivate(itemId)) {
            revert InvalidReactorId();
        }

        // Verify the battery item is valid
        if (!batteryItemIds[batteryItemId]) {
            revert InvalidBatteryId();
        }

        // Verify ownership of the reactor to be upgraded
        if (inventory.balanceOf(msg.sender, itemId) == 0) {
            revert ItemNotOwned();
        }

        // Verify ownership of battery required for activation
        if (inventory.balanceOf(msg.sender, batteryItemId) == 0) {
            revert ItemNotOwned();
        }

        // Consume battery as upgrade cost
        inventory.burnAdmin(msg.sender, batteryItemId, 1, "");

        // Burn the current reactor
        inventory.burnAdmin(msg.sender, itemId, 1, "");

        // Calculate and mint the upgraded reactor (next level)
        uint256 newItemId = itemId + reactorIdStep;
        inventory.mint(msg.sender, newItemId, 1, "");

        uint256 activatedAt = block.timestamp;
        uint256 expiryTime = activatedAt + activationDuration;

        // Record activation expiry to prevent immediate re-activation
        activeUntil[msg.sender] = expiryTime;

        emit Activated(msg.sender, itemId, newItemId, batteryItemId, activatedAt, expiryTime);
    }
}
