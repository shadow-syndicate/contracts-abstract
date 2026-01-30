// SPDX-License-Identifier: MIT
// Roach Racing Club: the first strategic p2e game with deflationary mechanisms (https://roachracingclub.com/)
pragma solidity ^0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IACID is IERC20 {
    function decimals() external view returns (uint8);
    function mint(address to, uint256 amount) external;
    function useFrom(address account, uint256 value, uint256 id, uint256 param, uint8 sigV, bytes32 sigR, bytes32 sigS) external;
}
