// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.0.0
pragma solidity ^0.8.0;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC1155Burnable} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Burnable.sol";
import {ERC1155Pausable} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title Inventory
/* Features:
    Mint+
    Claim+
    Use+
    Disable transfer for id+
    Ban+
    data in events+
    pause+
    Lock events?
    claim/use fee in eth+
    withdraw eth+
    claim trax
    id packing
    contractURI
    mint soulbound
    soulbound range
    deadline?
*/
contract Inventory is ERC1155, AccessControl, ERC1155Burnable, ERC1155Pausable {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
    bytes32 public constant BAN_ROLE = keccak256("BAN_ROLE");
    bytes32 public constant WITHDRAW_ROLE = keccak256("WITHDRAW_ROLE");

    /// @notice Address used to verify signatures
    address public signerAddress;

    mapping(uint => bool) public usedSignId;
    mapping(uint => bool) public transfersDisabled;
    mapping(address => bool) public banned;

    /// @notice Thrown when a user tries to hold more than one of the same badge
    error BalanceOverflow();

    /// @notice Thrown when a provided signature is invalid
    error WrongSignature();

    error ZeroAddress();
    error SignAlreadyUsed();
    error TransfersNotAllowed();
    error AccountBanned();
    error NotEnoughFee();
    error DeadlineExceeded();

    event SignUsed(uint indexed signId, address indexed account, uint256 indexed id, uint amount, bytes data);
    event ItemUsed(address indexed account, uint256 indexed id, uint amount, bytes data);
    event Locked(uint256 indexed tokenId);
    event Unlocked(uint256 indexed tokenId);
    event Banned(address account);
    event Unbanned(address account);

    /// @param defaultAdmin Address that will own the contract initially
    /// @param _uri Metadata URI for the ERC1155 tokens
    constructor(address defaultAdmin, address _signerAddress, string memory _uri) ERC1155(_uri) {
        if (defaultAdmin == address(0x0)) {
            revert ZeroAddress();
        }
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(MINTER_ROLE, defaultAdmin);
        signerAddress = _signerAddress;
    }

    // The following functions are overrides required by Solidity.
    function supportsInterface(bytes4 interfaceId)
       public
        view
        override(ERC1155, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    /// @notice Allows the owner to update the base URI for all tokens
    /// @param newuri The new metadata URI
    function setURI(string memory newuri) public onlyRole(DEFAULT_ADMIN_ROLE) {
        _setURI(newuri);
    }

    /// @notice Allows the owner to set the signer address used for claims
    /// @param newSigner The new signer address
    function setSigner(address newSigner) external onlyRole(DEFAULT_ADMIN_ROLE) {
        signerAddress = newSigner;
    }

    function mint(address account, uint256 id, uint256 amount, bytes memory data)
        public
        onlyRole(MINTER_ROLE)
    {
        _mint(account, id, amount, data);
    }

    function mintBatch(address to, uint256[] memory ids, uint256[] memory amounts, bytes memory data)
        public
        onlyRole(MINTER_ROLE)
    {
        _mintBatch(to, ids, amounts, data);
    }

    /// @notice Allows a user to claim a badge with a valid signature and custom data
    /// @param id Token ID of the badge to claim
    /// @param sigV V component of the signature
    /// @param sigR R component of the signature
    /// @param sigS S component of the signature
    /// @param data Additional data to include in the claim
    function claim(uint signId, uint256 id, uint amount, uint fee, uint8 sigV, bytes32 sigR, bytes32 sigS, bytes memory data) external payable {
        if (msg.value < fee) {
            revert NotEnoughFee();
        }
        address account = msg.sender;

        // Hash the claim parameters and contract address
        bytes32 msgHash = keccak256(abi.encode(signId, account, id, amount, fee, data, address(this), "claim"));

        // Recover signer from signature and validate
        if (ecrecover(msgHash, sigV, sigR, sigS) != signerAddress) {
            revert WrongSignature();
        }

        if (usedSignId[signId]) {
            revert SignAlreadyUsed();
        }
        usedSignId[signId] = true;

        _mint(account, id, amount, data);
        emit SignUsed(signId, account, id, amount, data);
    }

    function use(uint signId, uint256 id, uint amount, uint fee, uint deadline, uint8 sigV, bytes32 sigR, bytes32 sigS, bytes memory data) external payable {
        if (msg.value < fee) {
            revert NotEnoughFee();
        }
        if (deadline < block.timestamp) {
            revert DeadlineExceeded();
        }
        address account = msg.sender;
        // Hash the use parameters including deadline and contract address
        bytes32 msgHash = keccak256(abi.encode(signId, account, id, amount, fee, deadline, data, address(this), "use"));

        // Recover signer from signature and validate
        if (ecrecover(msgHash, sigV, sigR, sigS) != signerAddress) {
            revert WrongSignature();
        }

        if (usedSignId[signId]) {
            revert SignAlreadyUsed();
        }
        usedSignId[signId] = true;
        emit SignUsed(signId, account, id, amount, data);

        _use(account, id, amount,data);
    }

    function burnAdmin(address account, uint256 id, uint amount, bytes memory data)
        external
        onlyRole(BURNER_ROLE)
    {
        _use(account, id, amount, data);
    }

    function _use(address account, uint256 id, uint amount, bytes memory data) internal {
        _burn(account, id, amount);
        emit ItemUsed(account, id, amount, data);
    }

    /// @dev Internal hook that updates balances and checks badge ownership constraint
    /// @param from Address tokens are transferred from
    /// @param to Address tokens are transferred to
    /// @param ids Array of token IDs being transferred
    /// @param values Array of token amounts being transferred
    function _update(address from, address to, uint256[] memory ids, uint256[] memory values)
        internal
        override(ERC1155, ERC1155Pausable)
    {
        // Disallow transfers for some ids (allow only minting/burning)
        if (from != address(0) && to != address(0)) {
            // Check that recipient has only 1 badge of each type
            for (uint i = 0; i < ids.length; i++) {
                if (transfersDisabled[ids[i]]) {
                    revert TransfersNotAllowed();
                }
            }
        }

        if (banned[from] || banned[to]) {
            revert AccountBanned();
        }

        // Call parent update logic
        super._update(from, to, ids, values);
    }

    function disableTransfer(uint[] calldata ids) external onlyRole(DEFAULT_ADMIN_ROLE) {
        for (uint i = 0; i < ids.length; i++) {
            transfersDisabled[ids[i]] = true;
            emit Locked(ids[i]);
        }
    }

    function enableTransfer(uint[] calldata ids) external onlyRole(DEFAULT_ADMIN_ROLE) {
        for (uint i = 0; i < ids.length; i++) {
            delete(transfersDisabled[ids[i]]);
            emit Unlocked(ids[i]);
        }
    }

    function disableTransferRange(uint startId, uint endId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        for (uint i = startId; i <= endId; i++) {
            transfersDisabled[i] = true;
            emit Locked(i);
        }
    }

    function enableTransferRange(uint startId, uint endId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        for (uint i = startId; i <= endId; i++) {
            delete(transfersDisabled[i]);
            emit Unlocked(i);
        }
    }

    function ban(address account) external onlyRole(BAN_ROLE) {
        banned[account] = true;
        emit Banned(account);
    }

    function unban(address account) external onlyRole(BAN_ROLE) {
        delete(banned[account]);
        emit Unbanned(account);
    }

    function pause() public onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() public onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /**
     * @notice Withdraws the entire balance of the specified ERC-20 token from this contract to a target account.
     * @dev This function can only be called by accounts with the `WITHDRAW_ROLE` role.
     *      It transfers the entire token balance held by this contract to the specified target account.
     * @param _tokenContract The ERC-20 token contract from which the balance will be withdrawn.
     **/
    function withdrawERC20(IERC20 _tokenContract) external onlyRole(WITHDRAW_ROLE) {
        uint256 balance = _tokenContract.balanceOf(address(this));
        _tokenContract.transfer(msg.sender, balance);
    }

    function withdrawEth() external onlyRole(WITHDRAW_ROLE) {
        uint256 balance = address(this).balance;
        (bool success, ) = payable(msg.sender).call{value: balance}("");
        require(success, "ETH transfer failed");
    }

    /// @notice Converts uint to string (helper for uri)
    function _uint2str(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    /// @notice Returns the full URI for a given token ID.
    /// @param tokenId The ID of the token.
    /// @return A string representing the token metadata URI.
    function uri(uint256 tokenId) public view virtual override returns (string memory) {
        return string(abi.encodePacked(ERC1155.uri(tokenId), _uint2str(tokenId)));
    }
}
