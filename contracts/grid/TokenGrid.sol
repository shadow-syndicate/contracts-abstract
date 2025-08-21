// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.0.0
pragma solidity ^0.8.0;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title TokenGrid - Token handling functionality for Grid game
/// @notice Handles ERC20 token deposits, claims, and refunds with signature verification
/// @dev Independent contract for token operations with signature verification
contract TokenGrid is AccessControl {
    bytes32 public constant REFUND_ROLE = keccak256("REFUND_ROLE");
    bytes32 public constant WITHDRAW_ROLE = keccak256("WITHDRAW_ROLE");

    /// @notice Address used to verify deposit signatures
    address public signerAddress;

    /// @notice Address to receive automatic withdrawals when balance exceeds limits
    address public withdrawAddress;

    /// @notice Mapping to track processed order IDs to prevent double spending
    mapping(uint => bool) public processedOrders;

    /// @notice Minimum reserves coefficient in basis points (10000 = 100%)
    uint256 public minReservesCoef;

    /// @notice Maximum reserves coefficient in basis points (10000 = 100%)
    uint256 public maxReservesCoef;

    /// @notice Absolute minimum reserves that must always be present per token
    mapping(address => uint256) public minReserves;

    /// @notice Error thrown when a provided signature is invalid
    error WrongSignature();

    /// @notice Error thrown when an order has already been processed
    error OrderAlreadyProcessed();

    /// @notice Error thrown when a zero address is provided where not allowed
    error ZeroAddress();

    /// @notice Error thrown when reserved amount exceeds available balance
    error InsufficientBalance();

    /// @notice Error thrown when deadline has passed
    error DeadlineExpired();

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

    /// @notice Emitted when ERC20 tokens are refunded to an account
    /// @param account The address that received the refund
    /// @param token The ERC20 token contract address
    /// @param amount The amount refunded
    event TokenRefunded(address indexed account, address indexed token, uint256 amount);

    /// @notice Emitted when automatic withdrawal occurs
    /// @param token The token address
    /// @param amount The amount automatically withdrawn
    /// @param recipient The address that received the withdrawal
    event AutoWithdrawal(address indexed token, uint256 amount, address indexed recipient);

    /// @notice Emitted when reserve coefficients are updated
    /// @param minReservesCoef The new minimum reserves coefficient
    /// @param maxReservesCoef The new maximum reserves coefficient
    event ReserveCoefficientsUpdated(uint256 minReservesCoef, uint256 maxReservesCoef);

    /// @notice Emitted when minimum reserves are updated for a token
    /// @param token The token address
    /// @param minReserves The new minimum reserves amount
    event MinReservesUpdated(address indexed token, uint256 minReserves);

    /// @param defaultAdmin The address that will initially own the admin role
    /// @param _signerAddress The address authorized to sign deposit approvals
    constructor(address defaultAdmin, address _signerAddress) {
        if (defaultAdmin == address(0)) {
            revert ZeroAddress();
        }
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(WITHDRAW_ROLE, defaultAdmin);
        _grantRole(REFUND_ROLE, defaultAdmin);
        signerAddress = _signerAddress;
        withdrawAddress = defaultAdmin;
        
        // Set default reserve coefficients: min 110%, max 120%
        minReservesCoef = 11000;  // 110% (11000/10000)
        maxReservesCoef = 12000;  // 120% (12000/10000)
    }

    /// @notice Allows an admin to update the authorized signer address
    /// @param newSigner The new signer address
    function setSigner(address newSigner) external onlyRole(DEFAULT_ADMIN_ROLE) {
        signerAddress = newSigner;
    }

    /// @notice Set minimum and maximum reserve coefficients
    /// @param _minReservesCoef The minimum reserves coefficient in basis points (10000 = 100%)
    /// @param _maxReservesCoef The maximum reserves coefficient in basis points (10000 = 100%)
    function setReserveCoefficients(uint256 _minReservesCoef, uint256 _maxReservesCoef) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_minReservesCoef <= _maxReservesCoef, "Min coefficient must be <= max coefficient");
        minReservesCoef = _minReservesCoef;
        maxReservesCoef = _maxReservesCoef;
        emit ReserveCoefficientsUpdated(_minReservesCoef, _maxReservesCoef);
    }

    /// @notice Set the address to receive automatic withdrawals
    /// @param _withdrawAddress The address to receive automatic withdrawals
    function setWithdrawAddress(address _withdrawAddress) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_withdrawAddress == address(0)) {
            revert ZeroAddress();
        }
        withdrawAddress = _withdrawAddress;
    }

    /// @notice Set absolute minimum reserves for a token that must always be present
    /// @param token The token address
    /// @param _minReserves The minimum amount that must always be in the contract
    function setMinReserves(address token, uint256 _minReserves) external onlyRole(DEFAULT_ADMIN_ROLE) {
        minReserves[token] = _minReserves;
        emit MinReservesUpdated(token, _minReserves);
    }

    /// @notice Internal function to handle automatic withdrawals when balance exceeds limits
    /// @param token The token address
    /// @param systemBalance The system balance to consider
    function _autoWithdrawToken(address token, uint256 systemBalance) internal {
        // Calculate reserve amounts from coefficients
        uint256 minReservesFromCoef = (systemBalance * minReservesCoef) / 10000;
        uint256 maxReservesFromCoef = (systemBalance * maxReservesCoef) / 10000;
        
        // Use the greater of coefficient-based reserves or absolute minimum reserves
        uint256 effectiveMinReserves = minReservesFromCoef > minReserves[token] ? minReservesFromCoef : minReserves[token];
        
        // ERC20 token auto-withdrawal
        uint256 currentBalance = IERC20(token).balanceOf(address(this));
        uint256 maxAllowed = systemBalance + maxReservesFromCoef;
        
        if (currentBalance > maxAllowed) {
            uint256 targetBalance = systemBalance + effectiveMinReserves;
            if (currentBalance > targetBalance) {
                uint256 withdrawAmount = currentBalance - targetBalance;
                bool success = IERC20(token).transfer(withdrawAddress, withdrawAmount);
                if (success) {
                    emit AutoWithdrawal(token, withdrawAmount, withdrawAddress);
                }
            }
        }
    }

    /// @notice Deposit ERC20 tokens with signature verification
    /// @param orderId The unique identifier for this order
    /// @param token The ERC20 token contract address
    /// @param amount The amount of tokens to deposit
    /// @param deadline The deadline timestamp after which the signature is invalid
    /// @param systemBalance The system balance parameter
    /// @param sigV The V component of the signature
    /// @param sigR The R component of the signature
    /// @param sigS The S component of the signature
    function depositToken(uint orderId, address token, uint256 amount, uint deadline, uint systemBalance, uint8 sigV, bytes32 sigR, bytes32 sigS) external {
        if (processedOrders[orderId]) {
            revert OrderAlreadyProcessed();
        }

        if (block.timestamp > deadline) {
            revert DeadlineExpired();
        }

        bytes32 msgHash = keccak256(
            abi.encode(orderId, msg.sender, token, amount, deadline, systemBalance, address(this))
        );
        if (ecrecover(msgHash, sigV, sigR, sigS) != signerAddress) {
            revert WrongSignature();
        }

        processedOrders[orderId] = true;

        IERC20(token).transferFrom(msg.sender, address(this), amount);
        emit TokenDeposited(orderId, msg.sender, token, amount);

        // Auto-withdraw excess balance
        _autoWithdrawToken(token, systemBalance);
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

        bytes32 msgHash = keccak256(
            abi.encode(orderId, account, token, amount, address(this))
        );
        if (ecrecover(msgHash, sigV, sigR, sigS) != signerAddress) {
            revert WrongSignature();
        }

        processedOrders[orderId] = true;

        IERC20(token).transfer(account, amount);
        emit TokenClaimed(orderId, account, token, amount);
    }

    /// @notice Withdraws ERC-20 tokens held by the contract to the caller, leaving a reserved amount
    /// @param _tokenContract The ERC-20 contract address
    /// @param reserved The amount of tokens to leave in the contract
    function withdrawERC20(
        IERC20 _tokenContract,
        uint256 reserved
    ) external onlyRole(WITHDRAW_ROLE) {
        uint256 balance = _tokenContract.balanceOf(address(this));
        if (balance < reserved) {
            revert InsufficientBalance();
        }
        uint256 withdrawAmount = balance - reserved;
        _tokenContract.transfer(msg.sender, withdrawAmount);
    }

    /// @notice Refund ERC20 tokens to a specific account
    /// @param account The account to receive the refund
    /// @param token The ERC20 token contract address
    /// @param amount The amount of tokens to refund
    function refundToken(
        address account,
        address token,
        uint256 amount
    ) external onlyRole(REFUND_ROLE) {
        if (account == address(0)) {
            revert ZeroAddress();
        }
        IERC20(token).transfer(account, amount);
        emit TokenRefunded(account, token, amount);
    }
}