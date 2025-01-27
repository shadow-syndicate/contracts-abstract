// SPDX-License-Identifier: MIT
// Roach Racing Club: gamified trading competitions, where trading becomes a fun,
// fast-paced game set in the wicked Nanoverse (https://roachracingclub.com)
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

import {ITRAX} from "./interfaces/ITRAX.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

contract TraxExchange is AccessControl {
    bytes32 public constant SET_PRICE_ROLE = keccak256("SET_PRICE_ROLE");
    bytes32 public constant WITHDRAW_ROLE = keccak256("WITHDRAW_ROLE");

    ITRAX public immutable TRAX_TOKEN;
    mapping(IERC20 => uint256) public traxPrices;

    event Exchange(address indexed account, IERC20 indexed paymentToken, uint256 paymentValue, uint256 traxValue);
    event Price(IERC20 indexed paymentToken, uint256 price);

    error Overflow();
    error InvalidPaymentToken();
    error ZeroTraxValue();
    error ZeroAddress();

    constructor (ITRAX _traxToken, address defaultAdmin, address setPriceRole, address withdrawRole) {
        if (defaultAdmin == address(0x0) || address(_traxToken) == address(0x0)) {
            revert ZeroAddress();
        }
        TRAX_TOKEN = _traxToken;
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(SET_PRICE_ROLE, setPriceRole);
        _grantRole(WITHDRAW_ROLE, withdrawRole);
    }

    /**
     * @dev Calculates TRAX cost in `paymentToken`
     * `traxValueWithoutDecimals` is passed as value without decimals (eg `traxValueInteger` 12 means 12 TRAX)
     */
    function getTraxCost(IERC20 paymentToken, uint256 traxValueWithoutDecimals) public view returns (uint256) {
        (bool success, uint256 result) = Math.tryMul(traxValueWithoutDecimals, traxPrices[paymentToken]);
        if (!success) {
            revert Overflow();
        }
        return result;
    }

    /**
     * @dev Buy TRAX using `paymentToken` to pay.
     * `msg.sender` must give approve on `paymentToken` for TraxExchange contract.
     * Approve amount can be calculated using function `getTraxCost`
     * `traxValueWithoutDecimals` is desired TRAX amount to buy.
     * `traxValueWithoutDecimals` is passed as value without decimals (eg `traxValueWithoutDecimals` 12 means 12 TRAX)
     */
    function buyTrax(IERC20 paymentToken, uint256 traxValueWithoutDecimals) external {
        if (traxPrices[paymentToken] == 0) {
            revert InvalidPaymentToken();
        }

        address account = msg.sender;
        if (traxValueWithoutDecimals == 0) {
            revert ZeroTraxValue();
        }

        uint traxCostInPaymentTokens = getTraxCost(paymentToken, traxValueWithoutDecimals);

        IERC20(paymentToken).transferFrom(
            account,
            address(this),
            traxCostInPaymentTokens
        );

        (bool success, uint256 traxToMint) = Math.tryMul(traxValueWithoutDecimals, 10 ** TRAX_TOKEN.decimals());
        if (!success) {
            revert Overflow();
        }

        TRAX_TOKEN.mint(account, traxToMint);

        emit Exchange(account, paymentToken, traxCostInPaymentTokens, traxToMint);
    }

    /**
     * @dev This function allows the set exchange rate for TRAX.
     *      The function ensures that only SET_PRICE_ROLE can call this function.
     * @param paymentToken ERC-20 token used for exchange (USDC or another stablecoin)
     * @param price How much USDC is needed to purchase 1 TRAX
     *        Examples:
     *        For TOKEN with 18 decimals: if price = 3*1^18 it means 1 TRAX cost is 3 TOKEN
     *        For USDC with 6 decimals: if price = 3*1^6 it means 1 TRAX cost is 3 USDC
     */
    function setPrice(IERC20 paymentToken, uint256 price) external onlyRole(SET_PRICE_ROLE) {
        traxPrices[paymentToken] = price;
        emit Price(paymentToken, price);
    }

    /**
     * @notice Withdraws the entire balance of the specified ERC-20 token from this contract to a target account.
     * @dev This function can only be called by accounts with the `WITHDRAW_ROLE` role.
     *      It transfers the entire token balance held by this contract to the specified target account.
     * @param _tokenContract The ERC-20 token contract from which the balance will be withdrawn.
     * @param _targetAccount The address that will receive the token balance.
     **/
    function withdraw(IERC20 _tokenContract, address _targetAccount) external onlyRole(WITHDRAW_ROLE) {
        uint256 balance = _tokenContract.balanceOf(address(this));
        _tokenContract.transfer(_targetAccount, balance);
    }
}
