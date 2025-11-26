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
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title Bank
 * @dev Contract for accepting payments in ERC20 tokens and ETH.
 * Uses signature verification to validate and track payments.
 */
contract Bank is AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant WITHDRAW_ROLE = keccak256("WITHDRAW_ROLE");
    bytes32 public constant SIGNER_ROLE = keccak256("SIGNER_ROLE");

    mapping(uint256 => bool) public usedId;

    event Used(uint256 indexed id, uint256 value, address indexed token, address indexed sender, uint256 param);
    event Claimed(address indexed account, address indexed token, uint256 value, uint256 deadline, uint256 signId);
    event Withdrawn(address indexed token, address indexed recipient, uint256 amount);
    event WithdrawnEth(address indexed recipient, uint256 amount);

    error ZeroAddress();
    error WrongSignature();
    error IdUsed();
    error ZeroValue();
    error TransferFailed();
    error InsufficientBalance();
    error DeadlineExpired();

    constructor(address defaultAdmin, address withdrawRole, address signer) {
        if (defaultAdmin == address(0x0) || signer == address(0x0)) {
            revert ZeroAddress();
        }
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(WITHDRAW_ROLE, withdrawRole);
        _grantRole(SIGNER_ROLE, signer);
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
        uint256 deadline,
        uint8 sigV,
        bytes32 sigR,
        bytes32 sigS
    ) internal {
        if (block.timestamp > deadline) {
            revert DeadlineExpired();
        }
        bytes32 msgHash = keccak256(abi.encode('use', signId, value, token, account, param, deadline, address(this)));
        address signer = ecrecover(msgHash, sigV, sigR, sigS);
        if (!hasRole(SIGNER_ROLE, signer)) {
            revert WrongSignature();
        }
        if (usedId[signId]) {
            revert IdUsed();
        }
        usedId[signId] = true;
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
        _use(signId, msg.value, address(0), msg.sender, param, deadline, sigV, sigR, sigS);
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
        _use(signId, value, address(token), msg.sender, param, deadline, sigV, sigR, sigS);
    }

    /**
     * @notice Internal function to verify and process a claim signature.
     * @dev This function ensures that the provided signature is valid and has not been used before.
     *      It also marks the ID as used to prevent replay attacks.
     * @param signId The unique identifier for the claim to ensure it is only used once.
     * @param account The address of the account that will receive the claim.
     * @param token The token address (address(0) for ETH).
     * @param value The claim value.
     * @param deadline Timestamp after which the signature expires.
     * @param sigV The recovery ID component of the ECDSA signature.
     * @param sigR The R component of the ECDSA signature.
     * @param sigS The S component of the ECDSA signature.
     */
    function _claim(
        uint256 signId,
        address account,
        address token,
        uint256 value,
        uint256 deadline,
        uint8 sigV,
        bytes32 sigR,
        bytes32 sigS
    ) internal {
        if (account == address(0)) {
            revert ZeroAddress();
        }
        if (value == 0) {
            revert ZeroValue();
        }
        if (block.timestamp > deadline) {
            revert DeadlineExpired();
        }
        if (usedId[signId]) {
            revert IdUsed();
        }

        bytes32 message = keccak256(abi.encode('claim', signId, account, token, value, deadline, address(this)));
        address signer = ecrecover(message, sigV, sigR, sigS);

        if (!hasRole(SIGNER_ROLE, signer)) {
            revert WrongSignature();
        }

        usedId[signId] = true;
    }

    /**
     * @dev Claim tokens using an authorized signature
     * @param account Address that will receive the tokens
     * @param token ERC20 token address to claim
     * @param value Amount of tokens to claim
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
        uint256 deadline,
        uint256 signId,
        uint8 sigV,
        bytes32 sigR,
        bytes32 sigS
    ) external {
        if (token == address(0)) {
            revert ZeroAddress();
        }

        _claim(signId, account, token, value, deadline, sigV, sigR, sigS);

        IERC20 tokenContract = IERC20(token);
        uint256 balance = tokenContract.balanceOf(address(this));
        if (balance < value) {
            revert InsufficientBalance();
        }

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
        _claim(signId, account, address(0), value, deadline, sigV, sigR, sigS);

        if (address(this).balance < value) {
            revert InsufficientBalance();
        }

        (bool success,) = account.call{value: value}("");
        if (!success) {
            revert TransferFailed();
        }

        emit Claimed(account, address(0), value, deadline, signId);
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
        return usedId[signId];
    }

    /**
     * @dev Allow contract to receive ETH directly.
     */
    receive() external payable {}
}
