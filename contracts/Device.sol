// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/IInventory.sol";

/**
 * @title Device
 * @dev Device upgrade and activation contract. Allows users to upgrade devices by burning
 * batteries and the current device to receive the next level device. Each upgrade activates
 * a time-limited boost period during which no further upgrades are allowed.
 * Devices follow a sequential upgrade pattern with configurable limits.
 */
contract Device is AccessControl {
    // Role for managing device configuration
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

    // Inventory contract for minting/burning items
    IInventory public immutable inventory;
    // Item ID of the battery required for activation
    uint256 public batteryItemId;
    // Minimum device ID in the upgrade sequence
    uint256 public minDeviceId;
    // Maximum device ID in the upgrade sequence
    uint256 public maxDeviceId;
    // Step increment between device levels (e.g., 1 for sequential)
    uint256 public deviceIdStep;
    // Maximum number of activations allowed per device line
    uint256 public activationCount;
    // Duration in seconds that activation remains active
    uint256 public activationDuration;

    // Mapping from user address to their activation expiry timestamp
    mapping(address => uint256) public activeUntil;

    /**
     * @dev Emitted when a device is successfully activated/upgraded
     */
    event Activated(
        address indexed account,
        uint256 indexed burnedItemId,
        uint256 indexed mintedItemId,
        uint256 activatedAt,
        uint256 activeUntil
    );

    /**
     * @dev Emitted when the battery item ID is updated
     */
    event BatteryItemSet(uint256 indexed batteryItemId);

    /**
     * @dev Emitted when device range configuration is updated
     */
    event DeviceRangeSet(uint256 minId, uint256 maxId, uint256 step, uint256 count);

    // Custom errors for gas-efficient reverts
    error ItemNotOwned(); // User doesn't own required item
    error InvalidItemId(); // Item ID is not valid for activation
    error MaxActivationsReached(); // Device has reached max upgrade level
    error ActivationStillActive(); // Previous activation hasn't expired yet

    /**
     * @dev Constructor to initialize the Device contract
     * @param _inventory Address of the Inventory contract
     * @param _admin Address to be granted admin and manager roles
     * @param _batteryItemId ID of the battery item required for activation
     * @param _minDeviceId Starting device ID in the sequence
     * @param _maxDeviceId Maximum device ID in the sequence
     * @param _deviceIdStep Increment between device levels
     * @param _activationCount Maximum upgrades allowed per device line
     * @param _activationDuration Time in seconds activation remains active
     */
    constructor(
        address _inventory,
        address _admin,
        uint256 _batteryItemId,
        uint256 _minDeviceId,
        uint256 _maxDeviceId,
        uint256 _deviceIdStep,
        uint256 _activationCount,
        uint256 _activationDuration
    ) {
        inventory = IInventory(_inventory);
        _setBatteryItem(_batteryItemId);
        minDeviceId = _minDeviceId;
        maxDeviceId = _maxDeviceId;
        deviceIdStep = _deviceIdStep;
        activationCount = _activationCount;
        activationDuration = _activationDuration;
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(MANAGER_ROLE, _admin);
    }

    /**
     * @dev Internal function to set the battery item ID
     * @param _batteryItemId New battery item ID
     */
    function _setBatteryItem(uint256 _batteryItemId) internal {
        batteryItemId = _batteryItemId;
        emit BatteryItemSet(_batteryItemId);
    }

    /**
     * @dev Update the battery item ID required for activation
     * @param _batteryItemId New battery item ID
     */
    function setBatteryItem(uint256 _batteryItemId) external onlyRole(MANAGER_ROLE) {
        _setBatteryItem(_batteryItemId);
    }

    /**
     * @dev Configure the device upgrade sequence parameters
     * @param _minDeviceId Starting device ID
     * @param _maxDeviceId Maximum device ID
     * @param _deviceIdStep Increment between levels
     * @param _activationCount Max upgrades allowed
     */
    function setDeviceRange(
        uint256 _minDeviceId,
        uint256 _maxDeviceId,
        uint256 _deviceIdStep,
        uint256 _activationCount
    ) external onlyRole(MANAGER_ROLE) {
        minDeviceId = _minDeviceId;
        maxDeviceId = _maxDeviceId;
        deviceIdStep = _deviceIdStep;
        activationCount = _activationCount;
        emit DeviceRangeSet(_minDeviceId, _maxDeviceId, _deviceIdStep, _activationCount);
    }

    /**
     * @dev Update the activation duration
     * @param _activationDuration New duration in seconds
     */
    function setActivationDuration(uint256 _activationDuration) external onlyRole(MANAGER_ROLE) {
        activationDuration = _activationDuration;
    }

    /**
     * @dev Check if a device item can be activated/upgraded
     * @param itemId Device item ID to check
     * @return bool True if the device can be upgraded
     */
    function canActivate(uint256 itemId) public view returns (bool) {
        // Verify itemId is within the valid device range
        if (itemId < minDeviceId || itemId > maxDeviceId) {
            return false;
        }

        // Verify itemId follows the step pattern (e.g., 100, 101, 102 for step=1)
        if ((itemId - minDeviceId) % deviceIdStep != 0) {
            return false;
        }

        // Calculate the current activation level for this device
        uint256 activations = (itemId - minDeviceId) / deviceIdStep;

        // Ensure we haven't reached the maximum upgrade level
        return activations < activationCount;
    }

    /**
     * @dev Activate/upgrade a device by burning battery and current device
     * @param itemId Current device item ID to upgrade
     */
    function activate(uint256 itemId) external {
        // Ensure previous activation has expired before allowing new upgrade
        if (activeUntil[msg.sender] > block.timestamp) {
            revert ActivationStillActive();
        }

        // Verify the device is eligible for upgrade
        if (!canActivate(itemId)) {
            revert InvalidItemId();
        }

        // Verify ownership of the device to be upgraded
        if (inventory.balanceOf(msg.sender, itemId) == 0) {
            revert ItemNotOwned();
        }

        // Verify ownership of battery required for activation
        if (inventory.balanceOf(msg.sender, batteryItemId) == 0) {
            revert ItemNotOwned();
        }

        // Consume battery as upgrade cost
        inventory.burnAdmin(msg.sender, batteryItemId, 1, "");

        // Burn the current device
        inventory.burnAdmin(msg.sender, itemId, 1, "");

        // Calculate and mint the upgraded device (next level)
        uint256 newItemId = itemId + deviceIdStep;
        inventory.mint(msg.sender, newItemId, 1, "");

        uint256 activatedAt = block.timestamp;
        uint256 expiryTime = activatedAt + activationDuration;

        // Record activation expiry to prevent immediate re-activation
        activeUntil[msg.sender] = expiryTime;

        emit Activated(msg.sender, itemId, newItemId, activatedAt, expiryTime);
    }
}
