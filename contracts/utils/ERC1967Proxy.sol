// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @title InventoryProxy
/// @notice Transparent proxy contract for Inventory implementation
/// @dev Wrapper around OpenZeppelin's ERC1967Proxy with explicit constructor for verification
/// @custom:oz-upgrades-unsafe-allow delegatecall
contract InventoryProxy is ERC1967Proxy {
    /// @notice Initializes the proxy with implementation address and initialization data
    /// @param _logic Address of the implementation contract
    /// @param _data Encoded initialization call data
    constructor(address _logic, bytes memory _data) ERC1967Proxy(_logic, _data) {}
}