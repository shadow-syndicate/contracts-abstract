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

    uint public mintLimitPerTx = 10_000 * (10 ** decimals());
    address public signerAddress;
    mapping(uint => bool) public usedId;

    event Used(uint256 indexed id, uint256 value, address indexed sender, uint256 indexed param);

    error TransfersNotAllowed();
    error MintLimit();
    error ZeroAddress();
    error WrongSignature();
    error IdUsed();

    constructor(address defaultAdmin, address minter, address _signerAddress)
        ERC20("Roach Racing Club", "bTRAX")
    {
        if (defaultAdmin == address(0x0)) {
            revert ZeroAddress();
        }
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(MINTER_ROLE, minter);
        signerAddress = _signerAddress;
    }

    /**
     * @dev Pause mint and burn on migration started.
     * There is no unpause possible.
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @dev This function allows the minter role to mint TRAX tokens.
     *      The function ensures that only minter role can mint, and it enforces limits
     *      on the max minted value in one transaction.
     * @param to The address to which the minted tokens will be assigned.
     * @param amount Minted TRAX value
     */
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        if (amount > mintLimitPerTx) {
            revert MintLimit();
        }
        _mint(to, amount);
    }

    /**
     * @dev Set new limit per 1 transaction to avoid unlimited mints.
     */
    function setMintLimit(uint256 _newLimitPerTx) external onlyRole(DEFAULT_ADMIN_ROLE) {
        mintLimitPerTx = _newLimitPerTx;
    }

    /// @notice Changes signerAddress that is used for signature checking
    function setSigner(address newSigner) external onlyRole(DEFAULT_ADMIN_ROLE) {
        signerAddress = newSigner;
    }

    /**
     * @notice Internal function to verify and process a signed message for a specific action.
     * @dev This function ensures that the provided signature is valid and has not been used before.
     *      It also marks the ID as used to prevent replay attacks and emits an event upon successful execution.
     * @param id The unique identifier for the action to ensure it is only used once.
     * @param account The address of the account associated with the signed message.
     * @param param Serve controlled value used to provide information about player progress
     *              to Abstract portal (XP, achievements).
     * @param sigV The recovery ID component of the ECDSA signature.
     * @param sigR The R component of the ECDSA signature.
     * @param sigS The S component of the ECDSA signature.
     *
     * Requirements:
     * - The signature must be valid and signed by the `signerAddress`.
     * - The `id` must not have been used previously.
     *
     * Emits:
     * - `Used(uint256 id, uint256 value, address indexed sender)` upon successful validation and execution.
     *
     * Reverts:
     * - `WrongSignature()` if the signature is invalid or not signed by the expected signer.
     * - `IdUsed()` if the `id` has already been used.
     */
    function _use(uint256 value, uint256 id, address account, uint256 param, uint8 sigV, bytes32 sigR, bytes32 sigS) virtual internal {
        bytes32 msgHash = keccak256(abi.encode(id, value, account, param, address(this)));
        if (ecrecover(msgHash, sigV, sigR, sigS) != signerAddress) {
            revert WrongSignature();
        }
        if (usedId[id]) {
            revert IdUsed();
        }
        usedId[id] = true;
        emit Used(id, value, account, param);
    }

    /**
     * @dev Destroys a `value` amount of tokens from the caller
     * and marks destroyed 'value' as used with 'id'.
     * Emits a {Used} event.
     */
    function use(uint256 value, uint256 id, uint256 param, uint8 sigV, bytes32 sigR, bytes32 sigS) external {
        _burn(_msgSender(), value);
        _use(value, id, _msgSender(), param, sigV, sigR, sigS);
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
    function useFrom(address account, uint256 value, uint256 id, uint256 param, uint8 sigV, bytes32 sigR, bytes32 sigS) external {
        _spendAllowance(account, _msgSender(), value);
        _burn(account, value);
        _use(value, id, _msgSender(), param, sigV, sigR, sigS);
    }

    /**
     * @dev Make sure that token can be only minted and burned
     */
    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Pausable)
    {
        if (!((from == address(0x0) || to == address(0x0)))) {
            revert TransfersNotAllowed();
        }

        super._update(from, to, value);
    }

}
