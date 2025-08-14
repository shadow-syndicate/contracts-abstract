// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.0.0
pragma solidity ^0.8.0;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title Grid game
/// @notice A payment grid contract that handles ETH and ERC20 token deposits and claims with signature verification
/// @dev Uses cryptographic signatures to authorize deposits and claims. Each order ID can only be processed once to prevent double spending.
contract Grid is AccessControl {
    bytes32 public constant WITHDRAW_ROLE = keccak256("WITHDRAW_ROLE");

    /// @notice Address used to verify deposit signatures
    address public signerAddress;

    /// @notice Mapping to track processed order IDs to prevent double spending
    mapping(uint => bool) public processedOrders;

    /// @notice Error thrown when a provided signature is invalid
    error WrongSignature();

    /// @notice Error thrown when an order has already been processed
    error OrderAlreadyProcessed();

    /// @notice Error thrown when a zero address is provided where not allowed
    error ZeroAddress();

    /// @notice Error thrown when ETH transfer fails
    error EthTransferFailed();

    /// @notice Error thrown when reserved amount exceeds available balance
    error InsufficientBalance();

    /// @notice Emitted when a successful ETH deposit is made
    /// @param orderId The unique identifier for the order
    /// @param depositor The address that made the deposit
    /// @param amount The amount deposited in wei
    event EthDeposited(uint indexed orderId, address indexed depositor, uint256 amount);

    /// @notice Emitted when a successful ETH claim is made
    /// @param orderId The unique identifier for the order
    /// @param account The address that claimed the payment
    /// @param amount The amount claimed in wei
    event EthClaimed(uint indexed orderId, address indexed account, uint256 amount);

    /// @notice Emitted when a successful ERC20 token deposit is made
    /// @param orderId The unique identifier for the order
    /// @param depositor The address that made the deposit
    /// @param token The ERC20 token contract address
    /// @param amount The amount deposited
    event TokenDeposited(uint indexed orderId, address indexed depositor, address indexed token, uint256 amount);

    /// @notice Emitted when a successful ERC20 token claim is made
    /// @param orderId The unique identifier for the order
    /// @param account The address that claimed the tokens
    /// @param token The ERC20 token contract address
    /// @param amount The amount claimed
    event TokenClaimed(uint indexed orderId, address indexed account, address indexed token, uint256 amount);

    /// @param defaultAdmin The address that will initially own the admin role
    /// @param _signerAddress The address authorized to sign deposit approvals
    constructor(address defaultAdmin, address _signerAddress) {
        if (defaultAdmin == address(0)) {
            revert ZeroAddress();
        }
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(WITHDRAW_ROLE, defaultAdmin);
        signerAddress = _signerAddress;
    }


    /// @notice Allows an admin to update the authorized signer address
    /// @param newSigner The new signer address
    function setSigner(address newSigner) external onlyRole(DEFAULT_ADMIN_ROLE) {
        signerAddress = newSigner;
    }

    /// @notice Deposit ether with signature verification
    /// @param orderId The unique identifier for this order
    /// @param sigV The V component of the signature
    /// @param sigR The R component of the signature
    /// @param sigS The S component of the signature
    function deposit(uint orderId, uint8 sigV, bytes32 sigR, bytes32 sigS) external payable {
        if (processedOrders[orderId]) {
            revert OrderAlreadyProcessed();
        }

        bytes32 msgHash = keccak256(abi.encode(orderId, msg.sender, msg.value, address(this)));
        if (ecrecover(msgHash, sigV, sigR, sigS) != signerAddress) {
            revert WrongSignature();
        }

        processedOrders[orderId] = true;
        emit EthDeposited(orderId, msg.sender, msg.value);
    }

    /// @notice Deposit ERC20 tokens with signature verification
    /// @param orderId The unique identifier for this order
    /// @param token The ERC20 token contract address
    /// @param amount The amount of tokens to deposit
    /// @param sigV The V component of the signature
    /// @param sigR The R component of the signature
    /// @param sigS The S component of the signature
    function depositToken(uint orderId, address token, uint256 amount, uint8 sigV, bytes32 sigR, bytes32 sigS) external {
        if (processedOrders[orderId]) {
            revert OrderAlreadyProcessed();
        }

        bytes32 msgHash = keccak256(abi.encode(orderId, msg.sender, token, amount, address(this)));
        if (ecrecover(msgHash, sigV, sigR, sigS) != signerAddress) {
            revert WrongSignature();
        }

        processedOrders[orderId] = true;

        IERC20(token).transferFrom(msg.sender, address(this), amount);
        emit TokenDeposited(orderId, msg.sender, token, amount);
    }

    /// @notice Claim payment for an order with signature verification
    /// @param orderId The unique identifier for the order
    /// @param account The account to receive the payment
    /// @param value The amount to claim
    /// @param sigV The V component of the signature
    /// @param sigR The R component of the signature
    /// @param sigS The S component of the signature
    function claim(uint orderId, address account, uint256 value, uint8 sigV, bytes32 sigR, bytes32 sigS) external {
        if (processedOrders[orderId]) {
            revert OrderAlreadyProcessed();
        }

        bytes32 msgHash = keccak256(abi.encode(orderId, account, value, address(this)));
        if (ecrecover(msgHash, sigV, sigR, sigS) != signerAddress) {
            revert WrongSignature();
        }

        processedOrders[orderId] = true;

        (bool success, ) = payable(account).call{value: value}("");
        if (!success) {
            revert EthTransferFailed();
        }

        emit EthClaimed(orderId, account, value);
    }

    /// @notice Claim ERC20 tokens for an order with signature verification
    /// @param orderId The unique identifier for the order
    /// @param account The account to receive the tokens
    /// @param token The ERC20 token contract address
    /// @param amount The amount of tokens to claim
    /// @param sigV The V component of the signature
    /// @param sigR The R component of the signature
    /// @param sigS The S component of the signature
    function claimToken(uint orderId, address account, address token, uint256 amount, uint8 sigV, bytes32 sigR, bytes32 sigS) external {
        if (processedOrders[orderId]) {
            revert OrderAlreadyProcessed();
        }

        bytes32 msgHash = keccak256(abi.encode(orderId, account, token, amount, address(this)));
        if (ecrecover(msgHash, sigV, sigR, sigS) != signerAddress) {
            revert WrongSignature();
        }

        processedOrders[orderId] = true;

        IERC20(token).transfer(account, amount);
        emit TokenClaimed(orderId, account, token, amount);
    }

    /// @notice Withdraws ETH held by the contract to the caller, leaving a reserved amount
    /// @param reserved The amount of ETH to leave in the contract
    function withdrawEth(uint256 reserved) external onlyRole(WITHDRAW_ROLE) {
        uint256 balance = address(this).balance;
        if (balance < reserved) {
            revert InsufficientBalance();
        }
        uint256 withdrawAmount = balance - reserved;
        (bool success, ) = payable(msg.sender).call{value: withdrawAmount}("");
        if (!success) {
            revert EthTransferFailed();
        }
    }

    /// @notice Withdraws ERC-20 tokens held by the contract to the caller, leaving a reserved amount
    /// @param _tokenContract The ERC-20 contract address
    /// @param reserved The amount of tokens to leave in the contract
    function withdrawERC20(IERC20 _tokenContract, uint256 reserved) external onlyRole(WITHDRAW_ROLE) {
        uint256 balance = _tokenContract.balanceOf(address(this));
        if (balance < reserved) {
            revert InsufficientBalance();
        }
        uint256 withdrawAmount = balance - reserved;
        _tokenContract.transfer(msg.sender, withdrawAmount);
    }
}
