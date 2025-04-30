// SPDX-License-Identifier: MIT
// Roach Racing Club: gamified trading competitions, where trading becomes a fun,
// fast-paced game set in the wicked Nanoverse (https://roachracingclub.com)

pragma solidity ^0.8.22;

import "./interfaces/ITraxExchange.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ITRAX} from "./interfaces/ITRAX.sol";
import {ITraxExchange} from "./interfaces/ITraxExchange.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

contract TraxRedeem is AccessControl {
    bytes32 public constant WITHDRAW_ROLE = keccak256("WITHDRAW_ROLE");

    ITRAX public immutable TRAX_TOKEN;
    IERC20 public immutable USDC_TOKEN;
    uint public immutable TRAX_PRICE;
    ITraxExchange public immutable TRAX_EXCHANGE;

    error Overflow();
    error InvalidPaymentToken();
    error ZeroAddress();
    error LowReserves();

    //      *        For USDC with 6 decimals: if price = 3*1^6 it means 1 TRAX cost is 3 USDC
    constructor (
        ITRAX _traxToken,
        ITraxExchange _traxExchange,
        IERC20 _usdcToken,
        address defaultAdmin,
        address withdrawRole)
    {
        if (address(_traxToken) == address(0x0)
            || address(_traxExchange) == address(0x0)
            || address(_usdcToken) == address(0x0)
            || defaultAdmin == address(0x0)
            || withdrawRole == address(0x0)) {
            revert ZeroAddress();
        }
        TRAX_TOKEN = _traxToken;
        USDC_TOKEN = _usdcToken;
        TRAX_EXCHANGE = _traxExchange;
        TRAX_PRICE = TRAX_EXCHANGE.traxPrices(USDC_TOKEN);
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(WITHDRAW_ROLE, withdrawRole);
    }

    function redeem(uint256 value, uint256 id, uint256 param, uint8 sigV, bytes32 sigR, bytes32 sigS) external {
        if (!enoughReserves()) {
            revert LowReserves();
        }

        address account = msg.sender;

        // TRAX is burned inside useFrom
        // This only way to burn TRAX
        TRAX_TOKEN.useFrom(account, value, id, param, sigV, sigR, sigS);

        uint usdcValue = getTraxCost(value);

        _sendTokens(account, usdcValue);
    }

    function _sendTokens(address account, uint usdcValue) internal {
        // getAvailableBalance is called after TRAX burn inside useFrom
        int available = getAvailableBalance();
        if (available <= 0 || uint(available) < usdcValue) {
            revert LowReserves();
        }
        if (USDC_TOKEN.balanceOf(address(this)) < usdcValue) {
            _witdrawTraxExchange();
        }
        USDC_TOKEN.transfer(
            account,
            usdcValue
        );
    }

    function _witdrawTraxExchange() internal {
        TRAX_EXCHANGE.withdraw(USDC_TOKEN, address(this));
    }

    function getAvailableBalance() public view returns (int) {
        return
            int(USDC_TOKEN.balanceOf(address(this)))
            + int(USDC_TOKEN.balanceOf(address(TRAX_EXCHANGE)))
            - int(getReservedBalance());
    }

    function getReservedBalance() public view returns (uint) {
        uint traxSupply = TRAX_TOKEN.totalSupply();
        return getTraxCost(traxSupply);
    }

    function enoughReserves() public view returns (bool) {
        return getAvailableBalance() >= 0;
    }

    /**
     * @dev Calculates TRAX cost in USDC
     * `traxValue` ...
     */
    function getTraxCost(uint256 traxValue) public view returns (uint256) {
        (bool success, uint256 result) = Math.tryMul(traxValue, TRAX_PRICE);
        if (!success) {
            revert Overflow();
        }
        (success, result) = Math.tryDiv(result, 10**18); // TRAX 18 decimals
        if (!success) {
            revert Overflow();
        }
        return result;
    }

    function withdrawAll() external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 balance = USDC_TOKEN.balanceOf(address(this));
        USDC_TOKEN.transfer(msg.sender, balance);
    }

    function withdraw() external onlyRole(WITHDRAW_ROLE) {
        _witdrawTraxExchange();
        int256 balance = getAvailableBalance();
        if (balance < 0) {
            revert LowReserves();
        }
        USDC_TOKEN.transfer(msg.sender, uint(balance));
    }
}
