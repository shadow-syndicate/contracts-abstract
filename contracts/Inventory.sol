// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.0.0
//
// Roach Racing Club makes trading a social and competitive game —
// play with friends, prove your edge, and win while having fun
// https://roach.fun
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

pragma solidity ^0.8.0;

import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {ERC1155Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155Upgradeable.sol";
import {ERC1155BurnableUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC1155/extensions/ERC1155BurnableUpgradeable.sol";
import {ERC1155PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC1155/extensions/ERC1155PausableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "./interfaces/IInventory.sol";

/// @title Inventory
/// @notice ERC-1155 multi-token contract with advanced features for game inventory management.
/// @dev Upgradeable via the UUPS proxy pattern, with role-based access control.
/// @custom:security-contact security@example.com
/**
 * Features:
 * - Signature-based claiming and usage with replay protection.
 * - Configurable ETH fees for claim and use operations.
 * - Soulbound tokens (transferable or non-transferable per token ID).
 * - Account banning system.
 * - Pausable functionality for emergency stops.
 * - Role-based access control (MINTER, BURNER, BAN, and WITHDRAW roles).
 * - ETH and ERC20 withdrawal capabilities.
 * - Deadline-based signature validation.
 */
contract Inventory is Initializable, IInventory, AccessControlUpgradeable, ERC1155BurnableUpgradeable, ERC1155PausableUpgradeable, UUPSUpgradeable {
    using SafeERC20 for IERC20;

    /// @notice Role identifier for accounts authorized to mint new tokens
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /// @notice Role identifier for accounts authorized to burn tokens from other accounts
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");

    /// @notice Role identifier for accounts authorized to ban/unban users
    bytes32 public constant BAN_ROLE = keccak256("BAN_ROLE");

    /// @notice Role identifier for accounts authorized to withdraw funds and tokens
    bytes32 public constant WITHDRAW_ROLE = keccak256("WITHDRAW_ROLE");

    /// @notice Role identifier for accounts authorized to pause/unpause the contract
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @notice Address used to verify signatures for claim and use operations
    address public signerAddress;

    /// @notice Mapping to track used signature IDs to prevent replay attacks
    /// @dev signId => used status
    mapping(uint => bool) public usedSignId;

    /// @notice Mapping to track which token IDs have transfers disabled (soulbound)
    /// @dev tokenId => disabled status
    mapping(uint => bool) public transfersDisabled;

    /// @notice Mapping to track banned addresses
    /// @dev account => banned status
    mapping(address => bool) public banned;

    /// @notice Mapping to track maximum balance per owner for each token ID (0 = unlimited)
    /// @dev tokenId => max balance per owner
    mapping(uint256 => uint256) public maxBalancePerOwner;

    /// @notice Mapping to track restricted items per token ID (mutually exclusive ownership)
    /// @dev tokenId => array of restricted token IDs that cannot be owned simultaneously
    mapping(uint256 => uint256[]) public restrictedItems;

    /// @notice Thrown when receiving tokens would exceed the maximum balance per owner
    error MaxBalanceExceeded();

    /// @notice Thrown when attempting to receive a token that conflicts with restricted items
    error RestrictedItemConflict();

    /// @notice Thrown when a provided signature is invalid
    error WrongSignature();

    /// @notice Thrown when a zero address is provided where it's not allowed
    error ZeroAddress();

    /// @notice Thrown when attempting to use a signature that has already been used
    error SignAlreadyUsed();

    /// @notice Thrown when attempting to transfer a token that has transfers disabled
    error TransfersNotAllowed();

    /// @notice Thrown when a banned account attempts an operation
    error AccountBanned();

    /// @notice Thrown when insufficient fee is provided for an operation
    error NotEnoughFee();

    /// @notice Thrown when an operation is attempted after its deadline has passed
    error DeadlineExceeded();

    /// @notice Thrown when a zero value is provided where it's not allowed
    error ZeroValue();

    /// @notice Thrown when a transfer of ETH fails
    error TransferFailed();

    /// @notice Thrown when attempting to withdraw more than the available balance
    error InsufficientBalance();

    /// @notice Emitted when a signature is used for claim or use operation
    /// @param signId Unique identifier for the signature
    /// @param account Address of the user
    /// @param id Token ID
    /// @param amount Amount of tokens
    /// @param data Additional data passed with the operation
    event SignUsed(uint indexed signId, address indexed account, uint256 indexed id, uint amount, bytes data);

    /// @notice Emitted when tokens are successfully claimed by a user
    /// @param signId Unique identifier for the signature
    /// @param account Address of the user claiming tokens
    /// @param tokenId Token ID being claimed
    /// @param amount Amount of tokens claimed
    /// @param data Additional data passed with the claim operation
    event Claimed(uint indexed signId, address indexed account, uint256 indexed tokenId, uint amount, bytes data);

    /// @notice Emitted when an item is used (burned with additional logic)
    /// @param account Address of the user
    /// @param id Token ID
    /// @param amount Amount of tokens used
    /// @param data Additional data passed with the operation
    event ItemUsed(address indexed account, uint256 indexed id, uint amount, bytes data);

    /// @notice Emitted when transfers are disabled for a token ID (making it soulbound)
    /// @param tokenId The token ID that was locked
    event Locked(uint256 indexed tokenId);

    /// @notice Emitted when transfers are enabled for a previously locked token ID
    /// @param tokenId The token ID that was unlocked
    event Unlocked(uint256 indexed tokenId);

    /// @notice Emitted when an address is banned
    /// @param account The address that was banned
    event Banned(address account);

    /// @notice Emitted when an address is unbanned
    /// @param account The address that was unbanned
    event Unbanned(address account);

    /// @notice Emitted when ERC20 tokens are withdrawn from the contract
    /// @param token The address of the ERC20 token contract
    /// @param recipient The address receiving the tokens
    /// @param amount The amount of tokens withdrawn
    event Withdrawn(address indexed token, address indexed recipient, uint256 amount);

    /// @notice Emitted when ETH is withdrawn from the contract
    /// @param recipient The address receiving the ETH
    /// @param amount The amount of ETH withdrawn in wei
    event WithdrawnEth(address indexed recipient, uint256 amount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @param defaultAdmin Address that will own the contract initially
    /// @param _signerAddress Address used to verify signatures
    /// @param _uri Metadata URI for the ERC1155 tokens
    function initialize(address defaultAdmin, address _signerAddress, string memory _uri) public initializer {
        if (defaultAdmin == address(0x0)) {
            revert ZeroAddress();
        }

        __ERC1155_init(_uri);
        __ERC1155Burnable_init();
        __ERC1155Pausable_init();
        __AccessControl_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(MINTER_ROLE, defaultAdmin);
        signerAddress = _signerAddress;
    }

    /// @dev Function that should revert when msg.sender is not authorized to upgrade the contract
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    // The following functions are overrides required by Solidity.
    function supportsInterface(bytes4 interfaceId)
       public
        view
        override(ERC1155Upgradeable, AccessControlUpgradeable, IERC165)
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

    /// @notice Mints a specified amount of a token to an account
    /// @dev Only callable by accounts with MINTER_ROLE
    /// @param account Address to mint tokens to
    /// @param id Token ID to mint
    /// @param amount Amount of tokens to mint
    /// @param data Additional data to pass to the mint function
    function mint(address account, uint256 id, uint256 amount, bytes memory data)
        public
        onlyRole(MINTER_ROLE)
    {
        _mint(account, id, amount, data);
    }

    /// @notice Mints multiple token types to an account in a single transaction
    /// @dev Only callable by accounts with MINTER_ROLE
    /// @param to Address to mint tokens to
    /// @param ids Array of token IDs to mint
    /// @param amounts Array of amounts for each token ID
    /// @param data Additional data to pass to the mint function
    function mintBatch(address to, uint256[] memory ids, uint256[] memory amounts, bytes memory data)
        public
        onlyRole(MINTER_ROLE)
    {
        _mintBatch(to, ids, amounts, data);
    }

    /// @notice Mints a single token type to multiple addresses in a single transaction
    /// @dev Only callable by accounts with MINTER_ROLE
    /// @param addresses Array of addresses to mint tokens to
    /// @param tokenId Token ID to mint
    /// @param amount Amount of tokens to mint to each address
    /// @param data Additional data to pass to the mint function
    function mintBatchAddress(address[] memory addresses, uint256 tokenId, uint256 amount, bytes memory data)
        public
        onlyRole(MINTER_ROLE)
    {
        for (uint256 i = 0; i < addresses.length; i++) {
            _mint(addresses[i], tokenId, amount, data);
        }
    }

    /// @notice Allows a user to claim tokens with a valid signature from the authorized signer
    /// @dev Verifies signature, checks deadline, requires fee payment, and prevents replay attacks
    /// @param signId Unique signature identifier to prevent replay attacks
    /// @param tokenId Token ID to claim
    /// @param amount Amount of tokens to claim
    /// @param fee Required ETH fee for the claim operation (in wei)
    /// @param deadline Unix timestamp after which the claim expires
    /// @param sigV V component of the ECDSA signature
    /// @param sigR R component of the ECDSA signature
    /// @param sigS S component of the ECDSA signature
    /// @param data Additional data to include in the claim event
    function claim(uint signId, uint256 tokenId, uint amount, uint fee, uint deadline, uint8 sigV, bytes32 sigR, bytes32 sigS, bytes memory data) external payable {
        if (msg.value < fee) {
            revert NotEnoughFee();
        }
        if (deadline < block.timestamp) {
            revert DeadlineExceeded();
        }
        address account = msg.sender;

        // Hash the claim parameters including deadline and contract address
        bytes32 msgHash = keccak256(abi.encode(signId, account, tokenId, amount, fee, deadline, data, address(this), "claim"));

        // Recover signer from signature and validate
        if (ecrecover(msgHash, sigV, sigR, sigS) != signerAddress) {
            revert WrongSignature();
        }

        if (usedSignId[signId]) {
            revert SignAlreadyUsed();
        }
        usedSignId[signId] = true;

        _mint(account, tokenId, amount, data);
        emit Claimed(signId, account, tokenId, amount, data);
    }

    /// @notice Allows a user to use (burn) tokens with a valid signature from the authorized signer
    /// @dev Verifies signature, checks deadline, requires fee payment, prevents replay attacks, then burns tokens
    /// @param signId Unique signature identifier to prevent replay attacks
    /// @param id Token ID to use
    /// @param amount Amount of tokens to use
    /// @param fee Required ETH fee for the use operation (in wei)
    /// @param deadline Unix timestamp after which the use operation expires
    /// @param sigV V component of the ECDSA signature
    /// @param sigR R component of the ECDSA signature
    /// @param sigS S component of the ECDSA signature
    /// @param data Additional data to include in the use event
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

    /// @notice Allows authorized burners to burn tokens from any account
    /// @dev Only callable by accounts with BURNER_ROLE. Emits ItemUsed event
    /// @param account Address to burn tokens from
    /// @param id Token ID to burn
    /// @param amount Amount of tokens to burn
    /// @param data Additional data to include in the ItemUsed event
    function burnAdmin(address account, uint256 id, uint amount, bytes memory data)
        external
        onlyRole(BURNER_ROLE)
    {
        _use(account, id, amount, data);
    }

    /// @notice Internal function to burn tokens and emit ItemUsed event
    /// @dev Burns the specified amount of tokens and emits an event
    /// @param account Address to burn tokens from
    /// @param id Token ID to burn
    /// @param amount Amount of tokens to burn
    /// @param data Additional data to include in the ItemUsed event
    function _use(address account, uint256 id, uint amount, bytes memory data) internal {
        _burn(account, id, amount);
        emit ItemUsed(account, id, amount, data);
    }

    /// @dev Internal hook that updates balances and enforces transfer restrictions, bans, and balance limits
    /// @param from Address tokens are transferred from
    /// @param to Address tokens are transferred to
    /// @param ids Array of token IDs being transferred
    /// @param values Array of token amounts being transferred
    function _update(address from, address to, uint256[] memory ids, uint256[] memory values)
        internal
        override(ERC1155Upgradeable, ERC1155PausableUpgradeable)
    {
        // Disallow transfers for soulbound tokens (allow only minting/burning)
        if (from != address(0) && to != address(0)) {
            // Check if transfers are disabled for any of the token IDs
            for (uint i = 0; i < ids.length; i++) {
                if (transfersDisabled[ids[i]]) {
                    revert TransfersNotAllowed();
                }
            }
        }

        if (banned[from] || banned[to]) {
            revert AccountBanned();
        }

        // Check max balance per owner limit when minting or transferring to an address
        if (to != address(0)) {
            for (uint i = 0; i < ids.length; i++) {
                uint256 maxBalance = maxBalancePerOwner[ids[i]];
                if (maxBalance > 0) {
                    uint256 currentBalance = balanceOf(to, ids[i]);
                    if (currentBalance + values[i] > maxBalance) {
                        revert MaxBalanceExceeded();
                    }
                }

                // Check restricted items (mutually exclusive ownership)
                uint256[] storage restricted = restrictedItems[ids[i]];
                for (uint j = 0; j < restricted.length; j++) {
                    if (balanceOf(to, restricted[j]) > 0) {
                        revert RestrictedItemConflict();
                    }
                }
            }
        }

        // Call parent update logic
        super._update(from, to, ids, values);
    }

    /// @notice Disables transfers for specified token IDs, making them soulbound
    /// @dev Only callable by DEFAULT_ADMIN_ROLE. Emits Locked event for each token
    /// @param ids Array of token IDs to disable transfers for
    function disableTransfer(uint[] calldata ids) external onlyRole(DEFAULT_ADMIN_ROLE) {
        for (uint i = 0; i < ids.length; i++) {
            transfersDisabled[ids[i]] = true;
            emit Locked(ids[i]);
        }
    }

    /// @notice Enables transfers for specified token IDs, removing soulbound status
    /// @dev Only callable by DEFAULT_ADMIN_ROLE. Emits Unlocked event for each token
    /// @param ids Array of token IDs to enable transfers for
    function enableTransfer(uint[] calldata ids) external onlyRole(DEFAULT_ADMIN_ROLE) {
        for (uint i = 0; i < ids.length; i++) {
            delete(transfersDisabled[ids[i]]);
            emit Unlocked(ids[i]);
        }
    }

    /// @notice Disables transfers for a range of token IDs, making them soulbound
    /// @dev Only callable by DEFAULT_ADMIN_ROLE. Emits Locked event for each token in range
    /// @param startId First token ID in the range (inclusive)
    /// @param endId Last token ID in the range (inclusive)
    function disableTransferRange(uint startId, uint endId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        for (uint i = startId; i <= endId; i++) {
            transfersDisabled[i] = true;
            emit Locked(i);
        }
    }

    /// @notice Enables transfers for a range of token IDs, removing soulbound status
    /// @dev Only callable by DEFAULT_ADMIN_ROLE. Emits Unlocked event for each token in range
    /// @param startId First token ID in the range (inclusive)
    /// @param endId Last token ID in the range (inclusive)
    function enableTransferRange(uint startId, uint endId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        for (uint i = startId; i <= endId; i++) {
            delete(transfersDisabled[i]);
            emit Unlocked(i);
        }
    }

    /// @notice Bans an address from all token operations (transfers, mints, burns)
    /// @dev Only callable by BAN_ROLE. Emits Banned event
    /// @param account Address to ban
    function ban(address account) external onlyRole(BAN_ROLE) {
        banned[account] = true;
        emit Banned(account);
    }

    /// @notice Removes ban status from an address
    /// @dev Only callable by BAN_ROLE. Emits Unbanned event
    /// @param account Address to unban
    function unban(address account) external onlyRole(BAN_ROLE) {
        delete(banned[account]);
        emit Unbanned(account);
    }

    /// @notice Sets the maximum balance per owner for a specific token ID
    /// @dev Only callable by DEFAULT_ADMIN_ROLE. Set to 0 for unlimited
    /// @param tokenId The token ID to set the limit for
    /// @param maxBalance The maximum balance per owner (0 = unlimited)
    function setMaxBalancePerOwner(uint256 tokenId, uint256 maxBalance) external onlyRole(DEFAULT_ADMIN_ROLE) {
        maxBalancePerOwner[tokenId] = maxBalance;
    }

    /// @notice Sets the maximum balance per owner for multiple token IDs
    /// @dev Only callable by DEFAULT_ADMIN_ROLE. Set to 0 for unlimited
    /// @param tokenIds Array of token IDs to set limits for
    /// @param maxBalances Array of maximum balances corresponding to each token ID
    function setMaxBalancePerOwnerBatch(uint256[] calldata tokenIds, uint256[] calldata maxBalances) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(tokenIds.length == maxBalances.length, "Arrays length mismatch");
        for (uint256 i = 0; i < tokenIds.length; i++) {
            maxBalancePerOwner[tokenIds[i]] = maxBalances[i];
        }
    }

    /// @notice Sets restricted items for a single token ID (mutually exclusive ownership)
    /// @dev Only callable by DEFAULT_ADMIN_ROLE
    /// @param tokenId Token ID to set restrictions for
    /// @param restrictedItemsArray Array containing restricted token IDs
    function setRestrictedItems(uint256 tokenId, uint256[] calldata restrictedItemsArray) external onlyRole(DEFAULT_ADMIN_ROLE) {
        delete restrictedItems[tokenId];
        for (uint256 i = 0; i < restrictedItemsArray.length; i++) {
            restrictedItems[tokenId].push(restrictedItemsArray[i]);
        }
    }

    /// @notice Sets restricted items for multiple token IDs (mutually exclusive ownership)
    /// @dev Only callable by DEFAULT_ADMIN_ROLE
    /// @param tokenIds Array of token IDs to set restrictions for
    /// @param restrictedItemsArray Array of arrays containing restricted token IDs for each token
    function setRestrictedItemsBatch(uint256[] calldata tokenIds, uint256[][] calldata restrictedItemsArray) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(tokenIds.length == restrictedItemsArray.length, "Arrays length mismatch");
        for (uint256 i = 0; i < tokenIds.length; i++) {
            delete restrictedItems[tokenIds[i]];
            for (uint256 j = 0; j < restrictedItemsArray[i].length; j++) {
                restrictedItems[tokenIds[i]].push(restrictedItemsArray[i][j]);
            }
        }
    }

    /// @notice Gets restricted items for a token ID
    /// @param tokenId The token ID to query
    /// @return Array of restricted token IDs
    function getRestrictedItems(uint256 tokenId) external view returns (uint256[] memory) {
        return restrictedItems[tokenId];
    }

    /// @notice Pauses all token transfers, mints, and burns
    /// @dev Only callable by PAUSER_ROLE. Uses OpenZeppelin Pausable functionality
    function pause() public onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /// @notice Unpauses all token operations
    /// @dev Only callable by DEFAULT_ADMIN_ROLE. Uses OpenZeppelin Pausable functionality
    function unpause() public onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /**
     * @dev Withdraw tokens from the contract
     * @param token ERC20 token address to withdraw
     * @param recipient Address to receive the tokens
     * @param amount Amount of tokens to withdraw
     */
    function withdraw(
        address token,
        address recipient,
        uint256 amount
    ) external onlyRole(WITHDRAW_ROLE) {
        if (recipient == address(0) || token == address(0)) {
            revert ZeroAddress();
        }
        if (amount == 0) {
            revert ZeroValue();
        }

        IERC20(token).safeTransfer(recipient, amount);

        emit Withdrawn(token, recipient, amount);
    }

    /**
     * @dev Withdraw all tokens of a specific type from the contract
     * @param token ERC20 token address to withdraw
     */
    function withdrawAll(
        address token
    ) external onlyRole(WITHDRAW_ROLE) {
        address recipient = msg.sender;
        if (recipient == address(0) || token == address(0)) {
            revert ZeroAddress();
        }

        IERC20 tokenContract = IERC20(token);
        uint256 balance = tokenContract.balanceOf(address(this));

        if (balance == 0) {
            revert ZeroValue();
        }

        tokenContract.safeTransfer(recipient, balance);

        emit Withdrawn(token, recipient, balance);
    }

    /**
     * @dev Withdraw all ETH from the contract
     */
    function withdrawAllEth() external onlyRole(WITHDRAW_ROLE) {
        address recipient = msg.sender;
        if (recipient == address(0)) {
            revert ZeroAddress();
        }

        uint256 balance = address(this).balance;
        if (balance == 0) {
            revert ZeroValue();
        }

        (bool success,) = recipient.call{value: balance}("");
        if (!success) {
            revert TransferFailed();
        }

        emit WithdrawnEth(recipient, balance);
    }

    /**
     * @dev Withdraw ETH from the contract
     * @param recipient Address to receive the ETH
     * @param amount Amount of ETH to withdraw (in wei)
     */
    function withdrawEth(
        address payable recipient,
        uint256 amount
    ) external onlyRole(WITHDRAW_ROLE) {
        if (recipient == address(0)) {
            revert ZeroAddress();
        }
        if (amount == 0) {
            revert ZeroValue();
        }
        if (address(this).balance < amount) {
            revert InsufficientBalance();
        }

        (bool success,) = recipient.call{value: amount}("");
        if (!success) {
            revert TransferFailed();
        }

        emit WithdrawnEth(recipient, amount);
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
        return string(abi.encodePacked(ERC1155Upgradeable.uri(tokenId), _uint2str(tokenId)));
    }
}
