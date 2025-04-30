// SPDX-License-Identifier: MIT
// Roach Racing Club: the first strategic p2e game with deflationary mechanisms (https://roachracingclub.com/)
pragma solidity ^0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ITraxExchange {
    function withdraw(IERC20 _tokenContract, address _targetAccount) external;
    function traxPrices(IERC20 token) external view returns (uint256);
}
