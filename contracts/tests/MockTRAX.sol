// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockTRAX is ERC20 {
    constructor() ERC20("Mock TRAX", "mTRAX") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function decimals() public pure override returns (uint8) {
        return 18;
    }

    // Mock implementation of useFrom for testing - burns tokens without signature verification
    function useFrom(
        address account,
        uint256 value,
        uint256 /* id */,
        uint256 /* param */,
        uint8 /* sigV */,
        bytes32 /* sigR */,
        bytes32 /* sigS */
    ) external {
        _burn(account, value);
    }
}