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
import "./interfaces/IInventory.sol";

/**
 * @title Reactor
 * @dev Contract for Reactor upgrades and activations.
 * Allows users to upgrade reactors by burning batteries and the current reactor
 * to obtain the next-level reactor. Each upgrade triggers a time-limited boost period
 * during which no further upgrades are allowed.
 * Reactors follow a sequential upgrade path with configurable limits.
 */
contract Reactor is AccessControl {
    // Role for managing reactor configuration
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

    // Inventory contract for minting/burning items
    IInventory public immutable inventory;
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
     * @param _batteryDurations Array of activation durations for each battery type
     * @param _minReactorId Starting reactor ID in the sequence
     * @param _maxReactorId Maximum reactor ID in the sequence
     * @param _reactorIdStep Increment between reactor levels
     * @param _activationCount Maximum upgrades allowed per reactor line
     */
    constructor(
        address _inventory,
        address _admin,
        uint256[] memory _batteryItemIds,
        uint256[] memory _batteryDurations,
        uint256 _minReactorId,
        uint256 _maxReactorId,
        uint256 _reactorIdStep,
        uint256 _activationCount
    ) {
        require(_batteryItemIds.length == _batteryDurations.length, "Array length mismatch");
        inventory = IInventory(_inventory);
        for (uint256 i = 0; i < _batteryItemIds.length; i++) {
            _setBatteryItem(_batteryItemIds[i], _batteryDurations[i]);
        }
        minReactorId = _minReactorId;
        maxReactorId = _maxReactorId;
        reactorIdStep = _reactorIdStep;
        activationCount = _activationCount;
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(MANAGER_ROLE, _admin);
    }

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
        uint256 activations = (reactorItemId % reactorIdStep) / activationStep;

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

        // Verify the battery item is valid (has non-zero duration)
        uint256 activationDuration = batteryActivationDuration[batteryItemId];
        if (activationDuration == 0) {
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
        uint256 newItemId = itemId + activationStep;
        inventory.mint(msg.sender, newItemId, 1, "");

        uint256 activatedAt = block.timestamp;
        uint256 expiryTime = activatedAt + activationDuration;

        // Record activation expiry to prevent immediate re-activation
        activeUntil[msg.sender] = expiryTime;

        emit Activated(msg.sender, itemId, newItemId, batteryItemId, activatedAt, expiryTime);
    }
}
