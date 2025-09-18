// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/IInventory.sol";

// TODO: check active activation
contract Device is AccessControl {
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

    IInventory public immutable inventory;
    uint256 public batteryItemId;
    uint256 public minDeviceId;
    uint256 public maxDeviceId;
    uint256 public deviceIdStep;
    uint256 public activationCount;
    uint256 public activationDuration;

    mapping(address => uint256) public activeUntil;

    event Activated(
        address indexed account,
        uint256 indexed burnedItemId,
        uint256 indexed mintedItemId,
        uint256 activatedAt,
        uint256 activeUntil
    );

    event BatteryItemSet(uint256 indexed batteryItemId);
    event DeviceRangeSet(uint256 minId, uint256 maxId, uint256 step, uint256 count);

    error ItemNotOwned();
    error InvalidItemId();
    error MaxActivationsReached();
    error ActivationStillActive();

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

    function _setBatteryItem(uint256 _batteryItemId) internal {
        batteryItemId = _batteryItemId;
        emit BatteryItemSet(_batteryItemId);
    }

    function setBatteryItem(uint256 _batteryItemId) external onlyRole(MANAGER_ROLE) {
        _setBatteryItem(_batteryItemId);
    }

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

    function setActivationDuration(uint256 _activationDuration) external onlyRole(MANAGER_ROLE) {
        activationDuration = _activationDuration;
    }

    function canActivate(uint256 itemId) public view returns (bool) {
        // Check if itemId is within range
        if (itemId < minDeviceId || itemId > maxDeviceId) {
            return false;
        }

        // Check if itemId follows the step pattern starting from minDeviceId
        if ((itemId - minDeviceId) % deviceIdStep != 0) {
            return false;
        }

        // Calculate how many activations this item has had
        uint256 activations = (itemId - minDeviceId) / deviceIdStep;

        // Check if we haven't exceeded the activation count limit
        return activations < activationCount;
    }

    function activate(uint256 itemId) external {
        // Check if previous activation is still active
        if (activeUntil[msg.sender] > block.timestamp) {
            revert ActivationStillActive();
        }

        // Check if item can be activated
        if (!canActivate(itemId)) {
            revert InvalidItemId();
        }

        // Check if the user owns the item to upgrade
        if (inventory.balanceOf(msg.sender, itemId) == 0) {
            revert ItemNotOwned();
        }

        // Check if the user owns the battery
        if (inventory.balanceOf(msg.sender, batteryItemId) == 0) {
            revert ItemNotOwned();
        }

        // Burn the battery as payment
        inventory.burnAdmin(msg.sender, batteryItemId, 1, "");

        // Burn the current item
        inventory.burnAdmin(msg.sender, itemId, 1, "");

        // Mint the next sequential item
        uint256 newItemId = itemId + 1;
        inventory.mint(msg.sender, newItemId, 1, "");

        uint256 activatedAt = block.timestamp;
        uint256 expiryTime = activatedAt + activationDuration;

        // Store the activation expiry for this account
        activeUntil[msg.sender] = expiryTime;

        emit Activated(msg.sender, itemId, newItemId, activatedAt, expiryTime);
    }
}
