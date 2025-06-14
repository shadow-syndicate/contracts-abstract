// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.0.0
pragma solidity ^0.8.0;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title Badges
/// @notice ERC1155-based contract for managing unique badge tokens
/// @dev Each user can own at most 1 of each badge ID; transfers are disabled
contract Badges is ERC1155, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant WITHDRAW_ROLE = keccak256("WITHDRAW_ROLE");

    /// @notice Address used to verify claim signatures
    address public signerAddress;

    /// @notice Error thrown when a user tries to hold more than one of the same badge
    error BalanceOverflow();

    /// @notice Error thrown when a provided signature is invalid
    error WrongSignature();

    /// @notice Error thrown when a transfer attempt is made (transfers are not allowed)
    error TransfersNotAllowed();

    /// @notice Error thrown when a zero address is provided where it is not allowed
    error ZeroAddress();

    /// @notice Error thrown when sent fee is insufficient for a claim
    error NotEnoughFee();

    /// @notice Emitted when a badge is successfully claimed
    /// @param signId The identifier for the signed claim
    /// @param account The address that claimed the badge
    /// @param id The token ID of the badge claimed
    event Claimed(uint indexed signId, address indexed account, uint indexed id);

    /// @param defaultAdmin The address that will initially own the admin role
    /// @param _signerAddress The address authorized to sign claim approvals
    /// @param uri The base metadata URI for all token types
    constructor(address defaultAdmin, address _signerAddress, string memory uri) ERC1155(uri) {
        if (defaultAdmin == address(0)) {
            revert ZeroAddress();
        }
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(MINTER_ROLE, defaultAdmin);
        signerAddress = _signerAddress;
    }

    /// @notice Checks if the contract supports an interface
    /// @param interfaceId The interface identifier
    /// @return True if supported
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC1155, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    /// @notice Allows an admin to update the base URI for all tokens
    /// @param newuri The new base URI
    function setURI(string memory newuri) public onlyRole(DEFAULT_ADMIN_ROLE) {
        _setURI(newuri);
    }

    /// @notice Allows an admin to update the authorized signer address
    /// @param newSigner The new signer address
    function setSigner(address newSigner) external onlyRole(DEFAULT_ADMIN_ROLE) {
        signerAddress = newSigner;
    }

    /// @dev Internal hook to check for transfer rules and ownership constraints
    /// @param from The sender address
    /// @param to The recipient address
    /// @param ids The token IDs being transferred
    /// @param values The amounts being transferred
    function _update(address from, address to, uint256[] memory ids, uint256[] memory values)
        internal
        override(ERC1155)
    {
        super._update(from, to, ids, values);

        // Prevent transfers other than minting (from zero address) or burning (to zero address)
        if (from != address(0) || to == address(0)) {
            revert TransfersNotAllowed();
        }

        // Ensure recipient has only one of each badge ID
        for (uint i = 0; i < ids.length; i++) {
            if (balanceOf(to, ids[i]) != 1) {
                revert BalanceOverflow();
            }
        }
    }

    /// @notice Mint a badge with quantity 1 to a specific account
    /// @param account The address receiving the badge
    /// @param id The token ID to mint
    function mint(address account, uint256 id)
        public
        onlyRole(MINTER_ROLE)
    {
        _mint(account, id, 1, "");
    }

    /// @notice Mint multiple badges (each quantity 1) to a specific account
    /// @param to The address receiving the badges
    /// @param ids The token IDs to mint
    function mintBatch(address to, uint256[] memory ids)
        public
        onlyRole(MINTER_ROLE)
    {
        uint256[] memory amounts = new uint256[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            amounts[i] = 1;
        }
        _mintBatch(to, ids, amounts, "");
    }

    /// @notice Allows a user to claim a badge with a valid signature
    /// @param signId The identifier for the signed claim
    /// @param id The token ID to claim
    /// @param fee The fee required to claim
    /// @param sigV The V component of the signature
    /// @param sigR The R component of the signature
    /// @param sigS The S component of the signature
    function claim(uint signId, uint256 id, uint fee, uint8 sigV, bytes32 sigR, bytes32 sigS) external payable {
        if (msg.value < fee) {
            revert NotEnoughFee();
        }
        _claim(signId, msg.sender, id, fee, sigV, sigR, sigS);
    }

    /// @dev Handles the logic of verifying a claim signature and minting
    /// @param signId The identifier for the signed claim
    /// @param account The address claiming the badge
    /// @param id The token ID being claimed
    /// @param fee The fee for the claim
    /// @param sigV The V component of the signature
    /// @param sigR The R component of the signature
    /// @param sigS The S component of the signature
    function _claim(uint signId, address account, uint256 id, uint fee, uint8 sigV, bytes32 sigR, bytes32 sigS) internal {
        bytes32 msgHash = keccak256(abi.encode(signId, account, id, fee, address(this)));
        if (ecrecover(msgHash, sigV, sigR, sigS) != signerAddress) {
            revert WrongSignature();
        }
        _mint(account, id, 1, "");
        emit Claimed(signId, account, id);
    }

    /// @notice Withdraws all of a specified ERC-20 token to the caller
    /// @param _tokenContract The ERC-20 contract address
    function withdrawERC20(IERC20 _tokenContract) external onlyRole(WITHDRAW_ROLE) {
        uint256 balance = _tokenContract.balanceOf(address(this));
        _tokenContract.transfer(msg.sender, balance);
    }

    /// @notice Withdraws all ETH held by the contract to the caller
    function withdrawEth() external onlyRole(WITHDRAW_ROLE) {
        uint256 balance = address(this).balance;
        (bool success, ) = payable(msg.sender).call{value: balance}("");
        require(success, "ETH transfer failed");
    }
}
