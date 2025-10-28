// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract Staking {
    using SafeERC20 for IERC20;

    event Staked(address indexed user, uint256 indexed timestamp, uint256 amount);
    event Unstaked(address indexed user, uint indexed timestamp, uint amount);

    IERC20 immutable public stakingToken;

    constructor(address _stakingToken) {
        stakingToken = IERC20(_stakingToken);
    }

    function stake(uint amount) external {
        require(amount > 0, "Cannot stake 0");

        stakingToken.safeTransferFrom(msg.sender, address(this), amount);

        emit Staked(msg.sender, block.timestamp, amount);
    }

    function unstake(uint amount) external{
        require(amount > 0, "Cannot unstake 0");

        stakingToken.safeTransfer(msg.sender, amount);

        emit Unstaked(msg.sender, block.timestamp, amount);
    }
}
