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

contract TraxExchange is AccessControl {
    bytes32 public constant SET_PRICE_ROLE = keccak256("SET_PRICE_ROLE");
    bytes32 public constant WITHDRAW_ROLE = keccak256("WITHDRAW_ROLE");

    ITRAX public traxToken;
    // if traxPrices[TOKEN] = 3*1^18 it means 1 TRAX cost is 3 TOKEN (with 18 decimals)
    // if traxPrices[USDC] = 3*1^6 it means 1 TRAX cost is 3 USDC (with 6 decimals)
    mapping(IERC20 => uint256) public traxPrices;

    event Exchange(address indexed account, IERC20 paymentToken, uint256 paymentValue, uint256 traxValue);
    event Price(IERC20 paymentToken, uint256 price);

    constructor (ITRAX _traxToken, address defaultAdmin, address setPriceRole, address withdrawRole) {
        traxToken = _traxToken;
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(SET_PRICE_ROLE, setPriceRole);
        _grantRole(WITHDRAW_ROLE, withdrawRole);
    }

    function getTraxForToken(IERC20 paymentToken, uint256 paymentValue) public view returns (uint256) {
        return paymentValue * (1 ether) / traxPrices[paymentToken];
    }

    function buyTrax(IERC20 paymentToken, uint256 paymentValue) external {
        require(traxPrices[paymentToken] != 0, 'invalid payment token');

        address account = msg.sender;

        IERC20(paymentToken).transferFrom(
            account,
            address(this),
            paymentValue
        );

        uint traxValue = getTraxForToken(paymentToken, paymentValue);
        traxToken.mint(account, traxValue);

        emit Exchange(account, paymentToken, paymentValue, traxValue);
    }

    function setPrice(IERC20 paymentToken, uint256 price) external onlyRole(SET_PRICE_ROLE) {
        traxPrices[paymentToken] = price;
        emit Price(paymentToken, price);
    }

    function withdraw(IERC20 _tokenContract, address _targetAccount) external onlyRole(WITHDRAW_ROLE) {
        uint256 balance = _tokenContract.balanceOf(address(this));
        _tokenContract.transfer(_targetAccount, balance);
    }
}
