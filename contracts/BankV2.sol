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

import "./interfaces/ITRAX.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title BankV2
 * @dev Contract for accepting payments in ERC20 tokens and ETH.
 * Uses signature verification to validate and track payments.
 */
contract BankV2 is AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant WITHDRAW_ROLE = keccak256("WITHDRAW_ROLE");
    bytes32 public constant SIGNER_ROLE = keccak256("SIGNER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    mapping(uint256 => bool) public usedSignIds;
    // TRAX token contract for minting claims
    ITRAX public immutable traxToken;
    // Token send limits for operators (token => max amount per transaction)
    mapping(address => uint256) public sendTokenLimit;

    event Used(uint256 indexed signId, uint256 value, address indexed token, address indexed sender, uint256 param);
    event Claimed(address indexed account, address indexed token, uint256 value, uint256 deadline, uint256 signId);
    event Withdrawn(address indexed token, address indexed recipient, uint256 amount);
    event WithdrawnEth(address indexed recipient, uint256 amount);

    error ZeroAddress();
    error WrongSignature();
    error ZeroValue();
    error TransferFailed();
    error InsufficientBalance();
    error DeadlineExpired();
    error InsufficientFee();
    error SignIdAlreadyUsed();
    error ExceedsTokenLimit();

    constructor(address defaultAdmin, address withdrawRole, address signer, address _traxToken) {
        if (defaultAdmin == address(0x0) || signer == address(0x0) || _traxToken == address(0x0)) {
            revert ZeroAddress();
        }
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(WITHDRAW_ROLE, withdrawRole);
        _grantRole(SIGNER_ROLE, signer);
        traxToken = ITRAX(_traxToken);
    }

    /**
     * @notice Internal function to verify and process a signed message for a specific action.
     * @dev This function ensures that the provided signature is valid and has not been used before.
     *      It also marks the ID as used to prevent replay attacks and emits an event upon successful execution.
     * @param signId The unique identifier for the action to ensure it is only used once.
     * @param value The payment value.
     * @param token The token address (address(0) for ETH).
     * @param account The address of the account associated with the signed message.
     * @param param Server controlled value used to provide information about player progress.
     * @param fee Fee in ETH required for this action.
     * @param deadline Timestamp after which the signature expires.
     * @param sigV The recovery ID component of the ECDSA signature.
     * @param sigR The R component of the ECDSA signature.
     * @param sigS The S component of the ECDSA signature.
     */
    function _use(
        uint256 signId,
        uint256 value,
        address token,
        address account,
        uint256 param,
        uint256 fee,
        uint256 deadline,
        uint8 sigV,
        bytes32 sigR,
        bytes32 sigS
    ) internal {
        if (msg.value < fee) {
            revert InsufficientFee();
        }
        if (block.timestamp > deadline) {
            revert DeadlineExpired();
        }
        bytes32 msgHash = keccak256(abi.encode('use', signId, value, token, account, param, fee, deadline, address(this)));
        address signer = ecrecover(msgHash, sigV, sigR, sigS);
        if (!hasRole(SIGNER_ROLE, signer)) {
            revert WrongSignature();
        }
        if (usedSignIds[signId]) {
            revert SignIdAlreadyUsed();
        }
        usedSignIds[signId] = true;
        emit Used(signId, value, token, account, param);
    }

    /**
     * @dev Accept ETH payment with signature verification.
     * @param signId The unique identifier for the payment.
     * @param param Server controlled value.
     * @param deadline Timestamp after which the signature expires.
     * @param sigV ECDSA signature v component.
     * @param sigR ECDSA signature r component.
     * @param sigS ECDSA signature s component.
     */
    function useETH(
        uint256 signId,
        uint256 param,
        uint256 deadline,
        uint8 sigV,
        bytes32 sigR,
        bytes32 sigS
    ) external payable {
        if (msg.value == 0) {
            revert ZeroValue();
        }
        _use(signId, msg.value, address(0), msg.sender, param, 0, deadline, sigV, sigR, sigS);
    }

    /**
     * @dev Accept ERC20 token payment with signature verification.
     * Caller must approve this contract to spend the tokens beforehand.
     * @param token The ERC20 token contract address.
     * @param value The amount of tokens to transfer.
     * @param signId The unique identifier for the payment.
     * @param param Server controlled value.
     * @param deadline Timestamp after which the signature expires.
     * @param sigV ECDSA signature v component.
     * @param sigR ECDSA signature r component.
     * @param sigS ECDSA signature s component.
     */
    function useToken(
        IERC20 token,
        uint256 value,
        uint256 signId,
        uint256 param,
        uint256 deadline,
        uint8 sigV,
        bytes32 sigR,
        bytes32 sigS
    ) external {
        if (value == 0) {
            revert ZeroValue();
        }
        if (address(token) == address(0)) {
            revert ZeroAddress();
        }
        token.transferFrom(msg.sender, address(this), value);
        _use(signId, value, address(token), msg.sender, param, 0, deadline, sigV, sigR, sigS);
    }

    /**
     * @notice Internal function to verify and process a claim with signature verification.
     * @param signId Unique signature ID for this claim to prevent replay.
     * @param account Address that will receive the claim.
     * @param token Token address (address(0) for ETH, traxToken for TRAX mint).
     * @param value Amount to claim.
     * @param fee Fee in ETH required for this claim.
     * @param deadline Timestamp after which the signature expires.
     * @param sigV ECDSA signature v component.
     * @param sigR ECDSA signature r component.
     * @param sigS ECDSA signature s component.
     */
    function _claim(
        uint256 signId,
        address account,
        address token,
        uint256 value,
        uint256 fee,
        uint256 deadline,
        uint8 sigV,
        bytes32 sigR,
        bytes32 sigS
    ) internal {
        if (msg.value < fee) {
            revert InsufficientFee();
        }
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

        bytes32 message = keccak256(abi.encode('claim', signId, account, token, value, fee, deadline, address(this)));
        address signer = ecrecover(message, sigV, sigR, sigS);
        if (!hasRole(SIGNER_ROLE, signer)) {
            revert WrongSignature();
        }

        usedSignIds[signId] = true;

        emit Claimed(account, token, value, deadline, signId);
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
        if (token == address(0)) {
            revert ZeroAddress();
        }

        _claim(signId, account, token, value, fee, deadline, sigV, sigR, sigS);

        IERC20 tokenContract = IERC20(token);
        uint256 balance = tokenContract.balanceOf(address(this));
        if (balance < value) {
            revert InsufficientBalance();
        }

        tokenContract.safeTransfer(account, value);
    }

    /**
     * @dev Claim ETH using an authorized signature
     * @param account Address that will receive the ETH
     * @param value Amount of ETH to claim (in wei)
     * @param fee Fee in ETH required for this claim (must send as msg.value)
     * @param deadline Timestamp after which the signature expires
     * @param signId Unique signature ID for this claim to prevent replay
     * @param sigV ECDSA signature v component
     * @param sigR ECDSA signature r component
     * @param sigS ECDSA signature s component
     */
    function claimEth(
        address account,
        uint256 value,
        uint256 fee,
        uint256 deadline,
        uint256 signId,
        uint8 sigV,
        bytes32 sigR,
        bytes32 sigS
    ) external payable {
        _claim(signId, account, address(0), value, fee, deadline, sigV, sigR, sigS);

        if (address(this).balance < value) {
            revert InsufficientBalance();
        }

        (bool success,) = account.call{value: value}("");
        if (!success) {
            revert TransferFailed();
        }
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
        _claim(signId, account, address(traxToken), value, fee, deadline, sigV, sigR, sigS);

        traxToken.mint(account, value);
    }

    /**
     * @dev Set the send limit for a specific token or ETH (admin only)
     * @param token ERC20 token address (address(0) for ETH)
     * @param limit Maximum amount that can be sent per transaction (0 to disable sending)
     */
    function setSendTokenLimit(
        address token,
        uint256 limit
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        sendTokenLimit[token] = limit;
    }

    /**
     * @dev Send tokens from the contract to a recipient (operator only)
     * @param token ERC20 token address to send
     * @param recipient Address to receive the tokens
     * @param amount Amount of tokens to send
     */
    function sendToken(
        address token,
        address recipient,
        uint256 amount
    ) external onlyRole(OPERATOR_ROLE) {
        if (recipient == address(0) || token == address(0)) {
            revert ZeroAddress();
        }
        if (amount == 0) {
            revert ZeroValue();
        }
        if (amount > sendTokenLimit[token]) {
            revert ExceedsTokenLimit();
        }

        IERC20(token).safeTransfer(recipient, amount);
    }

    /**
     * @dev Send ETH from the contract to a recipient (operator only)
     * @param recipient Address to receive the ETH
     * @param amount Amount of ETH to send (in wei)
     */
    function sendEth(
        address recipient,
        uint256 amount
    ) external onlyRole(OPERATOR_ROLE) {
        if (recipient == address(0)) {
            revert ZeroAddress();
        }
        if (amount == 0) {
            revert ZeroValue();
        }
        if (amount > sendTokenLimit[address(0)]) {
            revert ExceedsTokenLimit();
        }
        if (address(this).balance < amount) {
            revert InsufficientBalance();
        }

        (bool success,) = recipient.call{value: amount}("");
        if (!success) {
            revert TransferFailed();
        }
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
     * @dev Get the balance of a specific token held by this contract
     * @param token ERC20 token address
     * @return Balance of the token
     */
    function getBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
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
     * @dev Allow contract to receive ETH directly.
     */
    receive() external payable {}
}
