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

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Pausable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";

contract TRAX is ERC20, ERC20Burnable, ERC20Pausable, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    event Used(uint256 id, uint256 value);

    constructor(address defaultAdmin, address minter)
        ERC20("TRAX Chips", "TRAX")
    {
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(MINTER_ROLE, minter);
    }

    /**
     * @dev Pause mint and burn on migration started,
     * There is no unpause possible.
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    /**
     * @dev Destroys a `value` amount of tokens from the caller
     * and marks destroyed 'value' as used with 'id'.
     * Emits a {Used} event.
     */
    function use(uint256 value, uint256 id) external {
        _burn(_msgSender(), value);
        emit Used(id, value);
    }

    /**
     * @dev Destroys a `value` amount of tokens from `account`, deducting from
     * the caller's allowance.
     * Marks destroyed 'value' as used with 'id'.
     * See {ERC20-_burn} and {ERC20-allowance}.
     *
     * Emits a {Used} event.
     *
     * Requirements:
     *
     * - the caller must have allowance for ``accounts``'s tokens of at least
     * `value`.
     */
    function useFrom(address account, uint256 value, uint256 id) external {
        _spendAllowance(account, _msgSender(), value);
        _burn(account, value);
        emit Used(id, value);
    }

    /**
     * @dev Make sure that token can be only minted and burned
     */
    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Pausable)
    {
        require (from == address(0x0) || to == address(0x0), 'transfers not allowed');
        super._update(from, to, value);
    }

}
