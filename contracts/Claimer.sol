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

pragma solidity ^0.8.22;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/ITRAX.sol";

/**
 * @title Claimer
 * @dev Allows users to claim ERC20 tokens using an authorized signature.
 * The contract can hold multiple ERC20 tokens and distribute them
 * based on off-chain authorizations signed by a designated signer.
 */
contract Claimer is AccessControl {
    using SafeERC20 for IERC20;

    // Role for accounts that can sign claim authorizations
    bytes32 public constant SIGNER_ROLE = keccak256("SIGNER_ROLE");
    // Role for withdrawing tokens from the contract
    bytes32 public constant WITHDRAW_ROLE = keccak256("WITHDRAW_ROLE");

    // TRAX token contract for minting claims
    ITRAX public immutable traxToken;

    // Mapping to track used signature IDs to prevent replay attacks
    mapping(uint256 => bool) public usedSignIds;

    /**
     * @dev Emitted when tokens are successfully claimed
     */
    event Claimed(
        address indexed account,
        address indexed token,
        uint256 value,
        uint256 deadline,
        uint256 signId
    );

    /**
     * @dev Emitted when ETH is successfully claimed
     */
    event ClaimedEth(
        address indexed account,
        uint256 value,
        uint256 deadline,
        uint256 signId
    );

    /**
     * @dev Emitted when tokens are withdrawn by admin
     */
    event Withdrawn(
        address indexed token,
        address indexed recipient,
        uint256 amount
    );

    /**
     * @dev Emitted when ETH is withdrawn by admin
     */
    event WithdrawnEth(
        address indexed recipient,
        uint256 amount
    );

    /**
     * @dev Emitted when TRAX is successfully claimed
     */
    event ClaimedTrax(
        address indexed account,
        uint256 value,
        uint256 deadline,
        uint256 signId
    );

    // Custom errors for gas-efficient reverts
    error InvalidSignature();
    error DeadlineExpired();
    error SignIdAlreadyUsed();
    error InsufficientBalance();
    error ZeroValue();
    error ZeroAddress();
    error TransferFailed();
    error InsufficientFee();

    /**
     * @dev Constructor to initialize the Claimer contract
     * @param _admin Address to be granted admin role
     * @param _signer Address to be granted signer role
     * @param _traxToken Address of the TRAX token contract
     */
    constructor(
        address _admin,
        address _signer,
        address _traxToken
    ) {
        if (_admin == address(0) || _signer == address(0) || _traxToken == address(0)) {
            revert ZeroAddress();
        }

        traxToken = ITRAX(_traxToken);
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(SIGNER_ROLE, _signer);
        _grantRole(WITHDRAW_ROLE, _admin);
    }

    /**
     * @dev Claim tokens using an authorized signature
     * @param account Address that will receive the tokens
     * @param token ERC20 token address to claim
     * @param value Amount of tokens to claim
     * @param fee Fee in ETH required for this claim (must send as msg.value)
     * @param deadline Timestamp after which the signature expires
     * @param signId Unique signature ID for this claim to prevent replay
     * @param sigV ECDSA signature v component
     * @param sigR ECDSA signature r component
     * @param sigS ECDSA signature s component
     */
    function claim(
        address account,
        address token,
        uint256 value,
        uint256 fee,
        uint256 deadline,
        uint256 signId,
        uint8 sigV,
        bytes32 sigR,
        bytes32 sigS
    ) external payable {
        // Validate fee payment
        if (msg.value < fee) {
            revert InsufficientFee();
        }

        // Validate inputs
        if (account == address(0) || token == address(0)) {
            revert ZeroAddress();
        }
        if (value == 0) {
            revert ZeroValue();
        }
        if (block.timestamp > deadline) {
            revert DeadlineExpired();
        }
        if (usedSignIds[signId]) {
            revert SignIdAlreadyUsed();
        }

        // Verify the signature
        bytes32 message = keccak256(abi.encode(signId, account, token, value, fee, deadline, address(this)));

        address signer = ecrecover(message, sigV, sigR, sigS);

        if (!hasRole(SIGNER_ROLE, signer)) {
            revert InvalidSignature();
        }

        // Mark signId as used
        usedSignIds[signId] = true;

        // Check contract has sufficient balance
        IERC20 tokenContract = IERC20(token);
        uint256 balance = tokenContract.balanceOf(address(this));
        if (balance < value) {
            revert InsufficientBalance();
        }

        // Transfer tokens to the account
        tokenContract.safeTransfer(account, value);

        emit Claimed(account, token, value, deadline, signId);
    }

    /**
     * @dev Claim ETH using an authorized signature
     * @param account Address that will receive the ETH
     * @param value Amount of ETH to claim (in wei)
     * @param deadline Timestamp after which the signature expires
     * @param signId Unique signature ID for this claim to prevent replay
     * @param sigV ECDSA signature v component
     * @param sigR ECDSA signature r component
     * @param sigS ECDSA signature s component
     */
    function claimEth(
        address account,
        uint256 value,
        uint256 deadline,
        uint256 signId,
        uint8 sigV,
        bytes32 sigR,
        bytes32 sigS
    ) external {
        // Validate inputs
        if (account == address(0)) {
            revert ZeroAddress();
        }
        if (value == 0) {
            revert ZeroValue();
        }
        if (block.timestamp > deadline) {
            revert DeadlineExpired();
        }
        if (usedSignIds[signId]) {
            revert SignIdAlreadyUsed();
        }

        // Verify the signature
        // Note: Using address(0) as token parameter to indicate ETH claim
        bytes32 message = keccak256(abi.encode(signId, account, address(0), value, deadline, address(this)));

        address signer = ecrecover(message, sigV, sigR, sigS);

        if (!hasRole(SIGNER_ROLE, signer)) {
            revert InvalidSignature();
        }

        // Mark signId as used
        usedSignIds[signId] = true;

        // Check contract has sufficient balance
        if (address(this).balance < value) {
            revert InsufficientBalance();
        }

        // Transfer ETH to the account
        (bool success,) = account.call{value: value}("");
        if (!success) {
            revert TransferFailed();
        }

        emit ClaimedEth(account, value, deadline, signId);
    }

    /**
     * @dev Claim TRAX tokens using an authorized signature
     * @param account Address that will receive the TRAX tokens
     * @param value Amount of TRAX to mint and claim (in wei, 18 decimals)
     * @param fee Fee in ETH required for this claim (must send as msg.value)
     * @param deadline Timestamp after which the signature expires
     * @param signId Unique signature ID for this claim to prevent replay
     * @param sigV ECDSA signature v component
     * @param sigR ECDSA signature r component
     * @param sigS ECDSA signature s component
     */
    function claimTrax(
        address account,
        uint256 value,
        uint256 fee,
        uint256 deadline,
        uint256 signId,
        uint8 sigV,
        bytes32 sigR,
        bytes32 sigS
    ) external payable {
        // Validate fee payment
        if (msg.value < fee) {
            revert InsufficientFee();
        }

        // Validate inputs
        if (account == address(0)) {
            revert ZeroAddress();
        }
        if (value == 0) {
            revert ZeroValue();
        }
        if (block.timestamp > deadline) {
            revert DeadlineExpired();
        }
        if (usedSignIds[signId]) {
            revert SignIdAlreadyUsed();
        }

        // Verify the signature
        // Note: Using address(traxToken) to indicate TRAX claim
        bytes32 message = keccak256(abi.encode(signId, account, address(traxToken), value, fee, deadline, address(this)));

        address signer = ecrecover(message, sigV, sigR, sigS);

        if (!hasRole(SIGNER_ROLE, signer)) {
            revert InvalidSignature();
        }

        // Mark signId as used
        usedSignIds[signId] = true;

        // Mint TRAX tokens to the account
        traxToken.mint(account, value);

        emit ClaimedTrax(account, value, deadline, signId);
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
     * @param recipient Address to receive the tokens
     */
    function withdrawAll(
        address token,
        address recipient
    ) external onlyRole(WITHDRAW_ROLE) {
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
     * @dev Get the balance of a specific token held by this contract
     * @param token ERC20 token address
     * @return Balance of the token
     */
    function getBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
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

    /**
     * @dev Withdraw all ETH from the contract
     * @param recipient Address to receive the ETH
     */
    function withdrawAllEth(
        address payable recipient
    ) external onlyRole(WITHDRAW_ROLE) {
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
     * @dev Get the ETH balance held by this contract
     * @return Balance of ETH (in wei)
     */
    function getEthBalance() external view returns (uint256) {
        return address(this).balance;
    }

    /**
     * @dev Check if a signature ID has been used
     * @param signId Signature ID to check
     * @return True if signId has been used
     */
    function isSignIdUsed(uint256 signId) external view returns (bool) {
        return usedSignIds[signId];
    }

    /**
     * @dev Allow the contract to receive ETH
     */
    receive() external payable {}
}
